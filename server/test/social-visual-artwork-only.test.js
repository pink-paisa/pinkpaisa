const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const sharp = require("sharp");

const {
  generateSocialVisuals,
} = require("../services/social/socialAiImageService");
const {
  _private: { buildRenderItems },
  renderSocialDraftAssets,
} = require("../services/socialCreativeService");
const {
  buildSocialCaptionContract,
} = require("../services/social/socialCaptionPolicy");
const {
  assertSocialVisualModeEligible,
  resolveSocialVisualMode,
} = require("../services/social/socialVisualPolicy");
const { getSocialManagerDefaults } = require("../utils/socialManagerSettings");

function checksum(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function memoryStore(records, prefix) {
  return async ({ fileName, buffer }) => {
    records.push({ fileName, buffer });
    return {
      url: `https://media.pinkpaisa.test/${prefix}/${fileName}`,
      storage_provider: "external",
      storage_key: `${prefix}/${fileName}`,
      checksum_sha256: checksum(buffer),
    };
  };
}

async function patternedImage(pattern = "ascending", marker = "#b84d75") {
  const tones = pattern === "descending"
    ? [230, 205, 180, 155, 130, 105, 80, 55, 30]
    : pattern === "alternating"
      ? [225, 25, 225, 25, 225, 25, 225, 25, 225]
      : [30, 55, 80, 105, 130, 155, 180, 205, 230];
  const columns = tones.map((tone, index) => (
    `<rect x="${index * 134}" y="0" width="134" height="1500" fill="rgb(${tone},${tone},${tone})" />`
  )).join("");
  const svg = Buffer.from(`<svg width="1200" height="1500" xmlns="http://www.w3.org/2000/svg">
    ${columns}
    <circle cx="6" cy="6" r="5" fill="${marker}" />
  </svg>`);
  return sharp({
    create: {
      width: 1200,
      height: 1500,
      channels: 3,
      background: "#fff8f3",
    },
  }).composite([{ input: svg }]).jpeg({ quality: 92 }).toBuffer();
}

function recommendation({ format = "SINGLE_IMAGE", objective = "EDUCATION" } = {}) {
  const base = {
    id: "artwork-only",
    internalTitle: "A calm money habit",
    topic: "A calm money habit",
    objective,
    format,
    postType: "EDUCATIONAL",
    contentPillar: "Money Education",
    verifiedProductId: null,
    verifiedProductFacts: null,
    caption: "Choose one useful habit that fits your real month.",
    cta: "Save this for your next money check-in.",
    financialDisclaimer: "Educational content only.",
    affiliateDisclosure: null,
    hashtags: ["#PinkPaisa", "#MoneyConfidence", "#WomenAndMoney", "#MoneyHabits", "#FinancialWellness"],
  };
  if (format === "CAROUSEL") {
    const slides = [1, 2, 3].map((sequence) => ({
      slideNumber: sequence,
      headline: `Money habit ${sequence}`,
      body: `A distinct practical action for slide ${sequence}.`,
      imagePrompt: `Create a different full-bleed editorial scene for carousel slide ${sequence}.`,
      overlayInstructions: "No overlay will be applied.",
    }));
    return {
      ...base,
      formatContent: {
        ...base,
        id: base.id,
        format,
        targetAudience: "Indian women building financial confidence",
        whyToday: "A useful evergreen reminder.",
        formatReason: "Three actions benefit from a sequence.",
        hookOptions: ["One calm habit", "Try this next", "A useful reset"],
        altText: "Three distinct editorial money-habit scenes.",
        recommendedLandingPage: null,
        sourceIndexes: [],
        slideCount: 3,
        narrativeArc: "Move from reflection to action.",
        cohesiveArtDirection: "Warm editorial photography with different subjects and actions.",
        slides,
      },
      visualBrief: {
        id: base.id,
        format,
        visualMode: "AI_ARTWORK_ONLY",
        textSafeRegions: [],
        assets: slides.map((slide, index) => ({
          sequence: index + 1,
          role: index ? "CAROUSEL_SLIDE" : "CAROUSEL_COVER",
          imagePrompt: slide.imagePrompt,
          overlayInstructions: "No overlay will be applied.",
          requiredObjects: [`Distinct scene object ${index + 1}`],
          prohibitedObjects: ["Text, logos, watermarks and duplicate compositions"],
        })),
      },
    };
  }
  return {
    ...base,
    formatContent: {
      ...base,
      id: base.id,
      format,
      targetAudience: "Indian women building financial confidence",
      whyToday: "A useful evergreen reminder.",
      formatReason: "One idea needs one image.",
      hookOptions: ["One calm habit", "Try this next", "A useful reset"],
      altText: "A warm full-bleed editorial money-habit scene.",
      recommendedLandingPage: null,
      sourceIndexes: [],
      selectedHeadline: "One calm money habit",
      supportingText: "Make it fit your real month.",
      imagePrompt: "Create one full-bleed editorial scene with no visible text or branding.",
      negativeVisualInstructions: ["No text, logos, labels, badges or watermarks."],
      overlayInstructions: {
        logoPosition: "Not used",
        headlinePosition: "Not used",
        safeAreaNotes: "No reserved text area.",
      },
    },
    visualBrief: {
      id: base.id,
      format,
      visualMode: "AI_ARTWORK_ONLY",
      textSafeRegions: [],
      assets: [{
        sequence: 1,
        role: "FEED_VISUAL",
        imagePrompt: "Create one full-bleed editorial scene with no visible text or branding.",
        overlayInstructions: "No overlay will be applied.",
        requiredObjects: ["An adult Indian woman and a notebook"],
        prohibitedObjects: ["Text, logos, labels, badges and watermarks"],
      }],
    },
  };
}

const generationSettings = {
  models: { image_provider: "openai", image_model: "gpt-image-2", image_quality: "medium" },
  generation: { max_image_retries: 2 },
};

test("new deployments default eligible creatives to native FULL_AI_GRAPHIC", () => {
  const previous = process.env.SOCIAL_DEFAULT_VISUAL_MODE;
  delete process.env.SOCIAL_DEFAULT_VISUAL_MODE;
  try {
    assert.equal(getSocialManagerDefaults().generation.default_visual_mode, "FULL_AI_GRAPHIC");
  } finally {
    if (previous === undefined) delete process.env.SOCIAL_DEFAULT_VISUAL_MODE;
    else process.env.SOCIAL_DEFAULT_VISUAL_MODE = previous;
  }
});

test("the native default allows non-promotional Stories and still protects authentic product content", () => {
  const storyResolution = resolveSocialVisualMode({
    requestedVisualMode: "FULL_AI_GRAPHIC",
    recommendation: recommendation({ format: "STORY", objective: "EDUCATION" }),
  });
  assert.equal(storyResolution.eligible, true);
  assert.equal(storyResolution.effective, "FULL_AI_GRAPHIC");

  for (const protectedRecommendation of [{
    ...recommendation({ format: "PRODUCT_FEATURE", objective: "PRODUCT_PROMOTION" }),
    postType: "AFFILIATE",
    verifiedProductId: "product-1",
  }, {
    ...recommendation({ format: "STORY", objective: "ENGAGEMENT" }),
    postType: "AFFILIATE",
    affiliateDisclosure: "Affiliate disclosure: Pink Paisa may earn a commission.",
  }]) {
    const resolution = resolveSocialVisualMode({
      requestedVisualMode: "FULL_AI_GRAPHIC",
      recommendation: protectedRecommendation,
    });
    assert.equal(resolution.eligible, false);
    assert.equal(resolution.effective, "AI_VISUAL_WITH_EXACT_OVERLAY");
  }
});

test("visual policy allows artwork-only only for the approved format/objective matrix", () => {
  for (const objective of ["AWARENESS", "EDUCATION", "ENGAGEMENT", "COMMUNITY_BUILDING"]) {
    for (const format of ["SINGLE_IMAGE", "CAROUSEL"]) {
      const resolution = resolveSocialVisualMode({
        requestedVisualMode: "AI_ARTWORK_ONLY",
        recommendation: recommendation({ format, objective }),
        strict: true,
      });
      assert.deepEqual(resolution, {
        requested: "AI_ARTWORK_ONLY",
        effective: "AI_ARTWORK_ONLY",
        eligible: true,
        reasons: [],
      });
    }
  }

  const productResolution = resolveSocialVisualMode({
    requestedVisualMode: "AI_ARTWORK_ONLY",
    recommendation: {
      ...recommendation(),
      format: "PRODUCT_FEATURE",
      objective: "PRODUCT_PROMOTION",
      postType: "AFFILIATE",
      verifiedProductId: "product-1",
    },
  });
  assert.equal(productResolution.effective, "AI_VISUAL_WITH_EXACT_OVERLAY");
  assert.equal(productResolution.eligible, false);
  assert.ok(productResolution.reasons.includes("AUTHENTIC_PRODUCT_REQUIRES_EXACT_OVERLAY"));
  assert.throws(
    () => assertSocialVisualModeEligible({ visualMode: "AI_ARTWORK_ONLY", recommendation: { ...recommendation(), format: "STORY" } }),
    (error) => error.code === "social_visual_mode_ineligible" && error.statusCode === 409,
  );

  for (const postType of [
    "PRODUCT",
    "PRODUCT_PROMOTION",
    "AFFILIATE",
    "PROMOTION",
    "RESOURCE",
    "RESOURCE_PROMOTION",
    "CALCULATOR",
    "EVENT",
    "EVENT_PROMOTION",
    "EVENT_OR_WORKSHOP_PROMOTION",
    "WORKSHOP",
    "WORKSHOP_PROMOTION",
  ]) {
    const resolution = resolveSocialVisualMode({
      requestedVisualMode: "AI_ARTWORK_ONLY",
      recommendation: { ...recommendation(), postType },
    });
    assert.equal(resolution.eligible, false, `${postType} must require exact-overlay mode`);
    assert.ok(resolution.reasons.includes("PROMOTIONAL_CONTENT_REQUIRES_EXACT_OVERLAY"));
  }
});

test("artwork-only generation validates zero text/logo and final rendering changes no pixels except resize/encoding", async () => {
  const source = await patternedImage("ascending");
  const originalStores = [];
  const generated = await generateSocialVisuals({
    draftLike: { idempotency_key: "artwork-only-render" },
    recommendation: recommendation(),
    settings: generationSettings,
    visualMode: "AI_ARTWORK_ONLY",
    dependencies: {
      generateOpenAiImage: async ({ prompt }) => {
        assert.match(prompt, /full-bleed/i);
        assert.match(prompt, /Do not reserve a text-safe area/i);
        return { buffer: source, response_id: "artwork-image-1", usage: {} };
      },
      validateArtworkOnlyVisual: async ({ buffer }) => {
        assert.equal(buffer.equals(source), true);
        return {
          decision: "PASS",
          hasVisibleText: false,
          hasLogoOrWatermark: false,
          observedText: null,
          issues: [],
          response_id: "artwork-check-1",
        };
      },
      storeCampaignAsset: memoryStore(originalStores, "original"),
    },
  });
  const finalStores = [];
  const rendered = await renderSocialDraftAssets({
    idempotency_key: "artwork-only-render",
    current_package: { primaryRecommendation: recommendation() },
  }, {
    recommendation: recommendation(),
    baseImages: generated.original_visuals,
    visualMode: "AI_ARTWORK_ONLY",
    persist: false,
    storeCampaignAsset: memoryStore(finalStores, "final"),
  });

  assert.equal(originalStores.length, 2);
  const retainedProviderOriginal = originalStores.find((row) => row.fileName.includes("openai-provider-original"));
  assert.equal(retainedProviderOriginal.buffer.equals(source), true);
  assert.equal(generated.original_visuals[0].provider_original.byte_preserving, true);
  assert.equal(generated.original_visuals[0].provider_original.checksum_sha256, checksum(source));
  assert.equal(generated.original_visuals[0].artwork_validation.validated_asset, "openai_provider_original");
  assert.equal(
    generated.original_visuals[0].normalization.source_checksum_sha256,
    generated.original_visuals[0].provider_original.checksum_sha256,
  );
  const expected = await sharp(generated.original_visuals[0].buffer, { failOn: "error", limitInputPixels: 40_000_000 })
    .rotate()
    .resize(1080, 1350, { fit: "cover", position: "attention" })
    .jpeg({ quality: 93, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
  assert.equal(checksum(finalStores[0].buffer), checksum(expected));
  assert.equal(rendered.renderer, "sharp_resize_only");
  assert.equal(rendered.assets[0].renderer, "sharp_resize_only");
  assert.equal(rendered.assets[0].provenance.overlay.method, "none");
  assert.equal(rendered.assets[0].provenance.logo, null);
  assert.equal(rendered.assets[0].overlay_json.text_rendering.method, "none");
  assert.equal(rendered.assets[0].provenance.caption_policy.method, "instagram_caption_only");
});

test("artwork-only zero-text/logo failure revises the prompt and retries before storage", async () => {
  const calls = [];
  const stores = [];
  let validations = 0;
  const result = await generateSocialVisuals({
    draftLike: { idempotency_key: "artwork-only-validation-retry" },
    recommendation: recommendation(),
    settings: generationSettings,
    visualMode: "AI_ARTWORK_ONLY",
    dependencies: {
      generateOpenAiImage: async ({ prompt }) => {
        calls.push(prompt);
        return {
          buffer: await patternedImage(calls.length === 1 ? "ascending" : "descending"),
          response_id: `artwork-retry-${calls.length}`,
          usage: {},
        };
      },
      validateArtworkOnlyVisual: async () => {
        validations += 1;
        return validations === 1
          ? {
            decision: "REGENERATE",
            hasVisibleText: true,
            hasLogoOrWatermark: true,
            observedText: "SALE",
            issues: ["Visible SALE badge and wordmark"],
            response_id: "artwork-check-retry-1",
          }
          : {
            decision: "PASS",
            hasVisibleText: false,
            hasLogoOrWatermark: false,
            observedText: null,
            issues: [],
            response_id: "artwork-check-retry-2",
          };
      },
      reviseImagePrompt: async () => ({
        prompt: "Create a revised full-bleed editorial scene with no badge, text, logo, wordmark, label or watermark.",
        response_id: "artwork-prompt-revision",
      }),
      sleep: async () => {},
      storeCampaignAsset: memoryStore(stores, "validation-retry"),
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(validations, 2);
  assert.equal(stores.length, 2);
  assert.equal(result.original_visuals[0].attempt_count, 2);
  assert.equal(result.original_visuals[0].failures[0].code, "social_artwork_only_visual_invalid");
  assert.equal(result.original_visuals[0].failures[0].prompt_revision.status, "COMPLETED");
});

test("carousel near-duplicates retry only the failing slide and retain perceptual hashes", async () => {
  const images = [
    await patternedImage("ascending", "#b84d75"),
    await patternedImage("ascending", "#6d3852"),
    await patternedImage("descending"),
    await patternedImage("alternating"),
  ];
  const calls = [];
  const stores = [];
  const result = await generateSocialVisuals({
    draftLike: { idempotency_key: "artwork-carousel-diversity" },
    recommendation: recommendation({ format: "CAROUSEL" }),
    settings: generationSettings,
    visualMode: "AI_ARTWORK_ONLY",
    dependencies: {
      generateOpenAiImage: async ({ prompt }) => {
        calls.push(prompt);
        return { buffer: images[calls.length - 1], response_id: `image-${calls.length}`, usage: {} };
      },
      validateArtworkOnlyVisual: async () => ({
        decision: "PASS",
        hasVisibleText: false,
        hasLogoOrWatermark: false,
        observedText: null,
        issues: [],
        response_id: "artwork-carousel-check",
      }),
      reviseImagePrompt: async ({ sequence }) => ({
        prompt: `Create a materially revised full-bleed scene for slide ${sequence} with a different subject, setting and action.`,
        response_id: "prompt-revision",
      }),
      sleep: async () => {},
      storeCampaignAsset: memoryStore(stores, "carousel"),
    },
  });

  assert.equal(calls.length, 4);
  assert.equal(stores.length, 6);
  assert.deepEqual(result.original_visuals.map((visual) => visual.sequence), [1, 2, 3]);
  assert.ok(result.original_visuals.every((visual) => /^[a-f0-9]{16}$/.test(visual.perceptual_hash_64)));
  assert.equal(result.original_visuals[1].failures[0].code, "social_carousel_original_near_duplicate");
  assert.equal(result.original_visuals[1].attempt_count, 2);
});

test("single-slide carousel regeneration generates only the requested sequence", async () => {
  const calls = [];
  const stores = [];
  const result = await generateSocialVisuals({
    draftLike: { idempotency_key: "artwork-carousel-slide-two" },
    recommendation: recommendation({ format: "CAROUSEL" }),
    settings: generationSettings,
    visualMode: "AI_ARTWORK_ONLY",
    assetSequence: 2,
    comparisonVisuals: [
      { sequence: 1, buffer: await patternedImage("ascending") },
      { sequence: 3, buffer: await patternedImage("descending") },
    ],
    dependencies: {
      generateOpenAiImage: async ({ prompt }) => {
        calls.push(prompt);
        return { buffer: await patternedImage("alternating"), response_id: "slide-two-only", usage: {} };
      },
      validateArtworkOnlyVisual: async () => ({
        decision: "PASS",
        hasVisibleText: false,
        hasLogoOrWatermark: false,
        observedText: null,
        issues: [],
        response_id: "artwork-slide-check",
      }),
      storeCampaignAsset: memoryStore(stores, "carousel-slide-two"),
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(stores.length, 2);
  assert.equal(result.partial_generation, true);
  assert.equal(result.requested_asset_sequence, 2);
  assert.deepEqual(result.original_visuals.map((visual) => visual.sequence), [2]);
});

test("caption contract has one canonical order and Stories move required copy onto frames", () => {
  const affiliate = {
    ...recommendation(),
    postType: "AFFILIATE",
    contentPillar: "Curated Wellness and Affiliate Products",
    affiliateDisclosure: "Affiliate disclosure: Pink Paisa may earn a commission.",
  };
  const contract = buildSocialCaptionContract(affiliate, {
    requireAffiliateDisclosure: true,
    requireFinancialDisclaimer: true,
  });
  assert.equal(contract.valid, true);
  assert.equal(contract.caption, [
    affiliate.affiliateDisclosure,
    affiliate.caption,
    affiliate.cta,
    affiliate.financialDisclaimer,
    affiliate.hashtags.join(" "),
  ].join("\n\n"));
  assert.equal(checksum(Buffer.from(contract.caption)), contract.checksum_sha256);

  const duplicate = buildSocialCaptionContract({ ...affiliate, caption: affiliate.cta });
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.violations.some((violation) => violation.endsWith("_MUST_OCCUR_EXACTLY_ONCE")));
  const duplicateHashtag = buildSocialCaptionContract({ ...affiliate, caption: `${affiliate.caption} #PinkPaisa` });
  assert.equal(duplicateHashtag.valid, false);
  assert.ok(duplicateHashtag.violations.includes("HASHTAGS_MUST_OCCUR_EXACTLY_ONCE"));

  const unprefixedHashtags = buildSocialCaptionContract({
    ...affiliate,
    hashtags: ["PinkPaisa", "#MoneyConfidence", "##EmergencyFund", "WomenAndMoney", "FinancialWellness"],
  });
  assert.equal(unprefixedHashtags.valid, true);
  assert.equal(
    unprefixedHashtags.components.hashtags,
    "#PinkPaisa #MoneyConfidence #EmergencyFund #WomenAndMoney #FinancialWellness",
  );
  assert.match(unprefixedHashtags.caption, /#PinkPaisa #MoneyConfidence #EmergencyFund #WomenAndMoney #FinancialWellness$/);

  const mixedCaseDuplicate = buildSocialCaptionContract({
    ...affiliate,
    caption: `${affiliate.caption} #pinkpaisa`,
    hashtags: ["PinkPaisa", "MoneyConfidence", "EmergencyFund", "WomenAndMoney", "FinancialWellness"],
  });
  assert.equal(mixedCaseDuplicate.valid, false);
  assert.ok(mixedCaseDuplicate.violations.includes("HASHTAGS_MUST_OCCUR_EXACTLY_ONCE"));

  const story = {
    ...affiliate,
    format: "STORY",
    formatContent: {
      ...affiliate.formatContent,
      format: "STORY",
      frames: [
        { frameNumber: 1, copy: "Start with one calm check-in." },
        { frameNumber: 2, copy: "Choose the next useful action." },
      ],
    },
  };
  const storyContract = buildSocialCaptionContract(story);
  assert.equal(storyContract.policy, "STORY_FRAME_OVERLAY");
  assert.equal(storyContract.caption, null);
  const frames = buildRenderItems(story, "STORY");
  assert.equal(frames[0].approved_copy.affiliateDisclosure, affiliate.affiliateDisclosure);
  assert.equal(frames[1].approved_copy.cta, affiliate.cta);
  assert.equal(frames[1].approved_copy.financialDisclaimer, affiliate.financialDisclaimer);

  const missingStoryCta = buildSocialCaptionContract({ ...story, cta: "", formatContent: { ...story.formatContent, cta: "" } });
  assert.equal(missingStoryCta.valid, false);
  assert.ok(missingStoryCta.violations.includes("CTA_REQUIRED"));
});

test("Story finals validate affiliate disclosure on frame one and CTA/disclaimer on the final frame", async () => {
  const affiliate = {
    ...recommendation(),
    format: "STORY",
    postType: "AFFILIATE",
    contentPillar: "Curated Wellness and Affiliate Products",
    affiliateDisclosure: "Affiliate disclosure: Pink Paisa may earn a commission.",
  };
  affiliate.formatContent = {
    ...affiliate.formatContent,
    format: "STORY",
    postType: affiliate.postType,
    contentPillar: affiliate.contentPillar,
    affiliateDisclosure: affiliate.affiliateDisclosure,
    frames: [
      { frameNumber: 1, copy: "Start with one calm check-in." },
      { frameNumber: 2, copy: "Choose the next useful action." },
    ],
  };
  affiliate.visualBrief = {
    id: "story-brief",
    format: "STORY",
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    textSafeRegions: ["Centre safe area"],
    assets: [1, 2].map((sequence) => ({
      sequence,
      role: "STORY_FRAME",
      imagePrompt: `Create text-free Story scene ${sequence}.`,
      overlayInstructions: "Keep the central safe area clear for exact copy.",
      requiredObjects: [],
      prohibitedObjects: ["Text and logos"],
    })),
  };

  const sources = [await patternedImage("ascending"), await patternedImage("descending")];
  const baseImages = sources.map((buffer, index) => ({
    buffer,
    source_url: `https://media.pinkpaisa.test/story/source-${index + 1}.jpg`,
    storage_provider: "external",
    storage_key: `story/source-${index + 1}.jpg`,
    checksum_sha256: checksum(buffer),
    provider: "openai",
    model: "gpt-image-2",
    prompt: `Validated Story scene ${index + 1}`,
    response_id: `story-image-${index + 1}`,
    status: "VALIDATED",
    source_provenance: "generated_without_reference",
    usage_rights_status: "api_permitted",
  }));
  const stores = [];
  const result = await renderSocialDraftAssets({
    idempotency_key: "captionless-story-policy",
    current_package: { primaryRecommendation: affiliate },
  }, {
    recommendation: affiliate,
    baseImages,
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    persist: false,
    storeCampaignAsset: memoryStore(stores, "story-final"),
  });

  assert.equal(stores.length, 2);
  assert.equal(result.assets[0].provenance.caption_policy.method, "story_frame_overlay");
  assert.equal(result.assets[0].overlay_json.approved_copy.affiliateDisclosure, affiliate.affiliateDisclosure);
  assert.equal(result.assets[1].overlay_json.approved_copy.cta, affiliate.cta);
  assert.equal(result.assets[1].overlay_json.approved_copy.financialDisclaimer, affiliate.financialDisclaimer);
  for (const asset of result.assets) {
    const storyPolicyCheck = asset.validation_checklist.find((item) => item.key === "story_frame_disclosure_policy");
    assert.equal(storyPolicyCheck?.status, "PASS");
  }
});
