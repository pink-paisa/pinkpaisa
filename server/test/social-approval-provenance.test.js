const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const SocialAsset = require("../models/SocialAsset");
const {
  _private: {
    creativeCopyFingerprint,
    fullAiRenderedHeadlineFingerprint,
    publicAsset,
    reviewAssetReadiness,
  },
} = require("../services/social/socialManagerService");
const { buildSocialCaptionContract } = require("../services/social/socialCaptionPolicy");
const { _private: { buildRenderItems } } = require("../services/socialCreativeService");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function checksum(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function recommendation(format = "SINGLE_IMAGE") {
  const value = {
    format,
    objective: "EDUCATION",
    postType: "EDUCATIONAL",
    contentPillar: "Money Education",
    caption: format === "STORY" ? "" : "Build one calm, repeatable money habit.",
    cta: "Save this for your next money check-in.",
    financialDisclaimer: "Educational content only; not personalised financial advice.",
    affiliateDisclosure: null,
    hashtags: format === "STORY" ? [] : ["#PinkPaisa", "#MoneyConfidence"],
  };
  if (format === "STORY") {
    value.onPostCopy = {
      headline: null,
      supportingCopy: null,
      slides: [],
      storyFrames: [{ frameNumber: 1, copy: "One calm money check-in", visualInstruction: "Warm editorial scene" }],
      reelScenes: [],
    };
    value.formatContent = {
      format: "STORY",
      frames: [{ frameNumber: 1, copy: "One calm money check-in", imagePrompt: "Warm editorial scene", overlayInstructions: "Exact copy" }],
    };
  } else {
    value.onPostCopy = {
      headline: "A calmer money habit",
      supportingCopy: "Small steps count.",
      slides: [],
      storyFrames: [],
      reelScenes: [],
    };
    value.formatContent = {
      format,
      selectedHeadline: "A calmer money habit",
      supportingText: "Small steps count.",
    };
  }
  return value;
}

function draftFor(mode, format = "SINGLE_IMAGE") {
  return {
    visual_mode: mode,
    visual_mode_resolution: { requested: mode, effective: mode, eligible: true, reasons: [] },
    current_package: { primaryRecommendation: recommendation(format) },
  };
}

function captionPolicy(format = "SINGLE_IMAGE", sourceRecommendation = recommendation(format)) {
  const contract = buildSocialCaptionContract(sourceRecommendation);
  const story = format === "STORY";
  return {
    method: story ? "story_frame_overlay" : "instagram_caption_only",
    component_order: contract.component_order,
    affiliate_disclosure_placement: story ? "first_frame" : "caption_only",
    cta_placement: story ? "final_frame" : "caption_only",
    financial_disclaimer_placement: story ? "final_frame" : "caption_only",
    affiliate_disclosure_required: false,
    cta_required: true,
    financial_disclaimer_required: true,
    instagram_caption_used: !story,
    caption_checksum_sha256: story ? null : contract.checksum_sha256,
    caption_contract_valid: true,
    caption_contract_violations: [],
  };
}

function bindExactAssetToRecommendation(asset, sourceRecommendation, sequence = 1) {
  const format = sourceRecommendation.format;
  const approvedCopy = buildRenderItems(sourceRecommendation, format)
    .find((item) => Number(item.sequence) === Number(sequence)).approved_copy;
  const approvedCopyChecksum = checksum(approvedCopy);
  asset.social_format = format;
  asset.asset_type = format === "CAROUSEL" ? "carousel_slide" : format === "STORY" ? "story_frame" : "feed_post";
  asset.slide_number = sequence;
  asset.approved_copy_checksum_sha256 = approvedCopyChecksum;
  asset.overlay_json.approved_copy = approvedCopy;
  asset.overlay_json.approved_copy_checksum_sha256 = approvedCopyChecksum;
  asset.provenance.overlay.approved_copy_checksum_sha256 = approvedCopyChecksum;
  asset.provenance.caption_policy = captionPolicy(format, sourceRecommendation);
  return asset;
}

function baseAsset(mode, format = "SINGLE_IMAGE") {
  const approvedCopy = buildRenderItems(recommendation(format), format)[0].approved_copy;
  const approvedCopyChecksum = checksum(approvedCopy);
  return {
    _id: `${mode}-${format}`,
    asset_role: "FINAL_COMPOSED",
    asset_type: format === "STORY" ? "story_frame" : "feed_post",
    social_format: format,
    visual_mode: mode,
    renderer: "sharp_svg_overlay",
    slide_number: 1,
    is_active: true,
    deleted_at: null,
    validation_status: "valid",
    manual_review_required: true,
    manual_review_status: "pending",
    image_generation_status: "VALIDATED",
    image_provider: "openai",
    image_model: "gpt-image-2",
    provider_response_id: "img-current-1",
    original_asset_url: "/uploads/generated/campaigns/openai-original.jpg",
    source_provenance: "generated_without_reference",
    approved_copy_checksum_sha256: approvedCopyChecksum,
    overlay_json: {
      brand_name: "Pink Paisa",
      approved_copy: approvedCopy,
      approved_copy_checksum_sha256: approvedCopyChecksum,
      text_rendering: { method: "sharp_svg_overlay", image_ai_used_for_text: false },
      logo: { source: "frontend-next/src/assets/pink-paisa-logo.png" },
    },
    provenance: {
      renderer: "sharp_svg_overlay",
      base_image: {
        type: "openai_generated_original_visual",
        provider: "openai",
        model: "gpt-image-2",
        response_id: "img-current-1",
        generation_status: "VALIDATED",
        original_asset_url: "/uploads/generated/campaigns/openai-original.jpg",
        source_provenance: "generated_without_reference",
      },
      overlay: {
        method: "sharp_svg_overlay",
        copy_source: "formatContent",
        approved_copy_checksum_sha256: approvedCopyChecksum,
        image_ai_used_for_text: false,
      },
      logo: { source: "frontend-next/src/assets/pink-paisa-logo.png" },
      caption_policy: captionPolicy(format),
    },
  };
}

function exactAsset(format = "SINGLE_IMAGE") {
  return baseAsset("AI_VISUAL_WITH_EXACT_OVERLAY", format);
}

function artworkOnlyAsset() {
  const asset = baseAsset("AI_ARTWORK_ONLY");
  const providerOriginal = {
    url: "/uploads/generated/campaigns/openai-provider-original.png",
    storage_provider: "local",
    storage_key: "uploads/generated/campaigns/openai-provider-original.png",
    checksum_sha256: "a".repeat(64),
    mime_type: "image/png",
    file_size_bytes: 4096,
    width: 1536,
    height: 2048,
    provider: "openai",
    model: "gpt-image-2",
    response_id: "img-current-1",
    byte_preserving: true,
  };
  const validation = {
    decision: "PASS",
    hasVisibleText: false,
    hasLogoOrWatermark: false,
    observedText: null,
    issues: [],
    response_id: "resp-vision-zero-text-1",
    validated_asset: "openai_provider_original",
  };
  asset.renderer = "sharp_resize_only";
  asset.original_asset_url = providerOriginal.url;
  asset.original_visual = {
    url: providerOriginal.url,
    storage_provider: providerOriginal.storage_provider,
    storage_key: providerOriginal.storage_key,
    checksum_sha256: providerOriginal.checksum_sha256,
    mime_type: providerOriginal.mime_type,
    file_size_bytes: providerOriginal.file_size_bytes,
    width: providerOriginal.width,
    height: providerOriginal.height,
  };
  asset.overlay_json.brand_name = null;
  asset.overlay_json.logo = { source: null };
  asset.overlay_json.text_rendering = {
    method: "none",
    image_ai_used_for_text: false,
    artwork_only_visual_validation: clone(validation),
  };
  asset.provenance.renderer = "sharp_resize_only";
  asset.provenance.base_image = {
    ...asset.provenance.base_image,
    original_asset_url: providerOriginal.url,
    checksum_sha256: "b".repeat(64),
    provider_original: providerOriginal,
    normalization: {
      renderer: "sharp_crop_resize_encode_v1",
      source_checksum_sha256: providerOriginal.checksum_sha256,
      output_checksum_sha256: "b".repeat(64),
    },
    artwork_validation: clone(validation),
  };
  asset.provenance.overlay = {
    method: "none",
    copy_source: null,
    approved_copy_checksum_sha256: asset.approved_copy_checksum_sha256,
    image_ai_used_for_text: false,
  };
  asset.provenance.logo = null;
  return asset;
}

function fullAiAsset() {
  const asset = baseAsset("FULL_AI_GRAPHIC");
  const validation = {
    decision: "PASS",
    exactHeadlineMatch: true,
    observedText: asset.overlay_json.approved_copy.selectedHeadline,
    response_id: "resp-vision-headline-1",
  };
  asset.overlay_json.text_rendering = {
    method: "openai_image_with_validated_short_headline",
    image_ai_used_for_text: true,
    full_ai_graphic_text_validation: clone(validation),
  };
  asset.provenance.base_image.contains_approved_copy_by_design = true;
  asset.provenance.base_image.text_validation = clone(validation);
  asset.provenance.overlay = {
    method: "sharp_branded_finish_after_validated_ai_headline",
    copy_source: "formatContent",
    approved_copy_checksum_sha256: asset.approved_copy_checksum_sha256,
    image_ai_used_for_text: true,
  };
  return asset;
}

test("approval readiness accepts each truthful active visual-mode contract", () => {
  for (const [mode, asset] of [
    ["AI_VISUAL_WITH_EXACT_OVERLAY", exactAsset()],
    ["AI_ARTWORK_ONLY", artworkOnlyAsset()],
    ["FULL_AI_GRAPHIC", fullAiAsset()],
  ]) {
    const readiness = reviewAssetReadiness([asset], { draft: draftFor(mode) });
    assert.equal(readiness.passed, true, `${mode}: ${readiness.issues.join(" | ")}`);
  }

  const storyReadiness = reviewAssetReadiness([exactAsset("STORY")], {
    draft: draftFor("AI_VISUAL_WITH_EXACT_OVERLAY", "STORY"),
  });
  assert.equal(storyReadiness.passed, true, storyReadiness.issues.join(" | "));
});

test("approval readiness rejects cross-field visual and caption provenance tampering", () => {
  const cases = [
    {
      name: "draft/asset visual-mode mismatch",
      draft: draftFor("AI_ARTWORK_ONLY"),
      asset: exactAsset(),
      expected: /visual mode does not match/i,
    },
    {
      name: "artwork-only compositor tamper",
      draft: draftFor("AI_ARTWORK_ONLY"),
      asset: Object.assign(artworkOnlyAsset(), { renderer: "sharp_svg_overlay" }),
      expected: /resize-only\/no-overlay/i,
    },
    {
      name: "artwork-only provider-original tamper",
      draft: draftFor("AI_ARTWORK_ONLY"),
      asset: (() => {
        const asset = artworkOnlyAsset();
        asset.provenance.base_image.provider_original.byte_preserving = false;
        return asset;
      })(),
      expected: /independent zero-text\/logo/i,
    },
    {
      name: "artwork-only vision evidence tamper",
      draft: draftFor("AI_ARTWORK_ONLY"),
      asset: (() => {
        const asset = artworkOnlyAsset();
        asset.overlay_json.text_rendering.artwork_only_visual_validation.hasVisibleText = true;
        return asset;
      })(),
      expected: /independent zero-text\/logo/i,
    },
    {
      name: "exact-overlay method tamper",
      draft: draftFor("AI_VISUAL_WITH_EXACT_OVERLAY"),
      asset: (() => {
        const asset = exactAsset();
        asset.provenance.overlay.method = "none";
        return asset;
      })(),
      expected: /verified Sharp exact-overlay/i,
    },
    {
      name: "legacy FULL_AI logo-only provenance label",
      draft: draftFor("FULL_AI_GRAPHIC"),
      asset: (() => {
        const asset = fullAiAsset();
        asset.provenance.overlay.method = "logo_only_after_validated_ai_headline";
        return asset;
      })(),
      expected: /Sharp branded-finish/i,
    },
    {
      name: "FULL_AI observed headline tamper",
      draft: draftFor("FULL_AI_GRAPHIC"),
      asset: (() => {
        const asset = fullAiAsset();
        asset.provenance.base_image.text_validation.observedText = "Different headline";
        return asset;
      })(),
      expected: /validated AI headline/i,
    },
    {
      name: "feed caption policy tamper",
      draft: draftFor("AI_VISUAL_WITH_EXACT_OVERLAY"),
      asset: (() => {
        const asset = exactAsset();
        asset.provenance.caption_policy.method = "story_frame_overlay";
        return asset;
      })(),
      expected: /caption-only policy/i,
    },
    {
      name: "Story policy tamper",
      draft: draftFor("AI_VISUAL_WITH_EXACT_OVERLAY", "STORY"),
      asset: (() => {
        const asset = exactAsset("STORY");
        asset.provenance.caption_policy.instagram_caption_used = true;
        return asset;
      })(),
      expected: /Story frame overlay/i,
    },
  ];

  for (const entry of cases) {
    const readiness = reviewAssetReadiness([entry.asset], { draft: entry.draft });
    assert.equal(readiness.passed, false, entry.name);
    assert.match(readiness.issues.join(" | "), entry.expected, entry.name);
  }
});

test("approval readiness binds each internally checksummed asset to current sequence copy and the complete media set", () => {
  const staleAsset = exactAsset();
  const staleCopy = { selectedHeadline: "A stale but internally consistent headline", supportingText: "Old supporting copy." };
  const staleChecksum = checksum(staleCopy);
  staleAsset.overlay_json.approved_copy = staleCopy;
  staleAsset.overlay_json.approved_copy_checksum_sha256 = staleChecksum;
  staleAsset.approved_copy_checksum_sha256 = staleChecksum;
  staleAsset.provenance.overlay.approved_copy_checksum_sha256 = staleChecksum;
  const staleReadiness = reviewAssetReadiness([staleAsset], {
    draft: draftFor("AI_VISUAL_WITH_EXACT_OVERLAY"),
  });
  assert.equal(staleReadiness.passed, false);
  assert.match(staleReadiness.issues.join(" | "), /verified Sharp exact-overlay/i);

  const carouselRecommendation = recommendation("SINGLE_IMAGE");
  carouselRecommendation.format = "CAROUSEL";
  carouselRecommendation.onPostCopy = {
    headline: null,
    supportingCopy: null,
    storyFrames: [],
    reelScenes: [],
    slides: [1, 2, 3].map((sequence) => ({
      slideNumber: sequence,
      headline: `Current approved slide ${sequence}`,
      body: `Distinct supporting copy ${sequence}`,
      visualInstruction: `Distinct scene ${sequence}`,
    })),
  };
  carouselRecommendation.formatContent = {
    format: "CAROUSEL",
    slides: [1, 2, 3].map((sequence) => ({
      slideNumber: sequence,
      headline: `Current approved slide ${sequence}`,
      body: `Distinct supporting copy ${sequence}`,
    })),
  };
  const carouselDraft = {
    visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    visual_mode_resolution: {
      requested: "AI_VISUAL_WITH_EXACT_OVERLAY",
      effective: "AI_VISUAL_WITH_EXACT_OVERLAY",
      eligible: true,
      reasons: [],
    },
    current_package: { primaryRecommendation: carouselRecommendation },
  };
  const truncatedAssets = [1, 2].map((sequence) => (
    bindExactAssetToRecommendation(exactAsset(), carouselRecommendation, sequence)
  ));
  const truncatedReadiness = reviewAssetReadiness(truncatedAssets, { draft: carouselDraft });
  assert.equal(truncatedReadiness.passed, false);
  assert.match(truncatedReadiness.issues.join(" | "), /complete approved CAROUSEL sequence \(1, 2, 3\)/i);
});

test("copy fingerprints recompose Story legal/CTA pixels while FULL_AI body-only edits preserve image calls", () => {
  const storyBefore = { primaryRecommendation: recommendation("STORY") };
  const storyAfter = clone(storyBefore);
  storyAfter.primaryRecommendation.cta = "Updated CTA that must be rendered on the final Story frame.";
  storyAfter.primaryRecommendation.formatContent.cta = storyAfter.primaryRecommendation.cta;
  assert.notEqual(
    creativeCopyFingerprint(storyBefore),
    creativeCopyFingerprint(storyAfter),
    "Story CTA changes must enter the retained-original recomposition path",
  );

  const fullAiBefore = { primaryRecommendation: recommendation("SINGLE_IMAGE") };
  const fullAiBodyEdit = clone(fullAiBefore);
  fullAiBodyEdit.primaryRecommendation.onPostCopy.supportingCopy = "Updated caption/supporting detail.";
  fullAiBodyEdit.primaryRecommendation.formatContent.supportingText = "Updated caption/supporting detail.";
  assert.equal(
    fullAiRenderedHeadlineFingerprint(fullAiBefore),
    fullAiRenderedHeadlineFingerprint(fullAiBodyEdit),
    "supporting/body edits must not spend another FULL_AI image call",
  );
  const fullAiHeadlineEdit = clone(fullAiBefore);
  fullAiHeadlineEdit.primaryRecommendation.onPostCopy.headline = "A genuinely new rendered headline";
  fullAiHeadlineEdit.primaryRecommendation.formatContent.selectedHeadline = "A genuinely new rendered headline";
  assert.notEqual(
    fullAiRenderedHeadlineFingerprint(fullAiBefore),
    fullAiRenderedHeadlineFingerprint(fullAiHeadlineEdit),
    "an actually AI-rendered headline change must require a new validated image",
  );

  const artworkDraft = draftFor("AI_ARTWORK_ONLY");
  artworkDraft.current_package.primaryRecommendation.onPostCopy.headline = "Updated external artwork-only headline";
  artworkDraft.current_package.primaryRecommendation.formatContent.selectedHeadline = "Updated external artwork-only headline";
  const artworkReadiness = reviewAssetReadiness([artworkOnlyAsset()], { draft: artworkDraft });
  assert.equal(artworkReadiness.passed, true, artworkReadiness.issues.join(" | "));

  const fullAiDraft = draftFor("FULL_AI_GRAPHIC");
  fullAiDraft.current_package.primaryRecommendation.onPostCopy.supportingCopy = "Updated non-rendered supporting copy.";
  fullAiDraft.current_package.primaryRecommendation.formatContent.supportingText = "Updated non-rendered supporting copy.";
  const fullAiReadiness = reviewAssetReadiness([fullAiAsset()], { draft: fullAiDraft });
  assert.equal(fullAiReadiness.passed, true, fullAiReadiness.issues.join(" | "));
});

test("inactive MANUAL_TEMPLATE history with legacy placement fields remains model-readable but cannot satisfy approval", () => {
  const approvedCopy = { headline: "Historical template", supportingCopy: "Readable history" };
  const copyChecksum = checksum(approvedCopy);
  const legacy = new SocialAsset({
    draft_key: "historical-template",
    asset_group_id: "historical-template-v1",
    version: "legacy-v1",
    asset_role: "FINAL_COMPOSED",
    asset_type: "feed_post",
    social_format: "SINGLE_IMAGE",
    visual_mode: "MANUAL_TEMPLATE",
    canvas_format: "FEED_4_5",
    slide_number: 1,
    url: "/uploads/generated/campaigns/historical-template.jpg",
    storage_provider: "local",
    storage_key: "uploads/generated/campaigns/historical-template.jpg",
    checksum_sha256: "c".repeat(64),
    media_kind: "IMAGE",
    publication_role: "PRIMARY_MEDIA",
    mime_type: "image/jpeg",
    file_size_bytes: 2048,
    width: 1080,
    height: 1350,
    aspect_ratio: "4:5",
    renderer: "legacy_sharp_template",
    render_version: "legacy-v1",
    approved_copy_checksum_sha256: copyChecksum,
    overlay_json: {
      approved_copy: approvedCopy,
      approved_copy_checksum_sha256: copyChecksum,
      overlayInstructions: {
        ctaPosition: "Lower-left safe area",
        disclosurePosition: "Bottom safe edge",
      },
    },
    image_generation_status: "NOT_APPLICABLE",
    provenance: { base_image: { type: "pink_paisa_brand_template" } },
    source_provenance: "brand_template",
    usage_rights_status: "owned",
    is_active: false,
  });

  assert.equal(legacy.validateSync(), undefined);
  const serialized = publicAsset(legacy);
  assert.equal(serialized.visual_mode, "MANUAL_TEMPLATE");
  assert.equal(serialized.is_active, false);
  assert.equal(serialized.provenance.base_image.type, "pink_paisa_brand_template");
  assert.equal(
    legacy.overlay_json.overlayInstructions.disclosurePosition,
    "Bottom safe edge",
  );

  const readiness = reviewAssetReadiness([legacy], {
    draft: draftFor("AI_VISUAL_WITH_EXACT_OVERLAY"),
  });
  assert.equal(readiness.passed, false);
  assert.match(readiness.issues.join(" | "), /No active final composed creative/i);
});
