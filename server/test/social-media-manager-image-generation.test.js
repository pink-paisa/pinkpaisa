const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const sharp = require("sharp");

const {
  buildProductionImagePrompt,
  callOpenAiImage,
  generateSocialVisuals,
  validateArtworkOnlyVisual,
  validateFullAiGraphicText,
  _private: { fullAiGraphicTextBlocksForSequence },
} = require("../services/social/socialAiImageService");
const {
  renderSocialDraftAssets,
  validateSocialAsset,
} = require("../services/socialCreativeService");
const {
  _private: {
    fullAiDraftManifestFromAssets,
    imageAttemptRows,
    imagePromptRevisionResult,
    reviewAssetReadiness,
  },
} = require("../services/social/socialManagerService");

function checksum(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function passingBrandLogoValidation(contract, overrides = {}) {
  const box = contract.safe_corner.target_box;
  return {
    decision: "PASS",
    badgeId: contract.reference_asset_id,
    referenceChecksumSha256: contract.reference_checksum_sha256,
    approvedLogoPresent: true,
    referenceIdentityMatch: true,
    wordmarkExactMatch: true,
    iconGeometryMatch: true,
    brandColourMatch: true,
    registeredMarkRecognizable: true,
    singleBadgeOccurrence: true,
    observedBadgeCount: 1,
    observedBadgeWidthPx: 210,
    safeCornerMatch: true,
    fullyInsideSafeBox: true,
    acceptedWidthRange: true,
    observedCorner: contract.locked_corner,
    normalizedBoundingBox: {
      x: box.left / box.canvas_width,
      y: box.top / box.canvas_height,
      width: box.width / box.canvas_width,
      height: box.height / box.canvas_height,
    },
    mobileLegible: true,
    protectedContentOverlapPresent: false,
    unapprovedTextPresent: false,
    observedUnapprovedText: null,
    unrelatedLogoOrWatermarkPresent: false,
    post_generation_logo_overlay_applied: false,
    issues: [],
    response_id: "brand-logo-validator-pass",
    ...overrides,
  };
}

async function generatedImageBuffer(seed = 1) {
  const tonePatterns = [
    [20, 45, 70, 95, 120, 145, 170, 195, 220],
    [220, 195, 170, 145, 120, 95, 70, 45, 20],
    [220, 25, 220, 25, 220, 25, 220, 25, 220],
  ];
  const tones = tonePatterns[(seed - 1) % tonePatterns.length];
  const columns = tones.map((tone, index) => (
    `<rect x="${index * 134}" y="0" width="134" height="1500" fill="rgb(${tone},${tone},${tone})" />`
  )).join("");
  const overlay = Buffer.from(`<svg width="1200" height="1500" xmlns="http://www.w3.org/2000/svg">
    ${columns}
  </svg>`);
  return sharp({
    create: {
      width: 1200,
      height: 1500,
      channels: 3,
      background: {
        r: (80 + (seed * 37)) % 255,
        g: (40 + (seed * 61)) % 255,
        b: (120 + (seed * 29)) % 255,
      },
    },
  }).composite([{ input: overlay, top: 0, left: 0 }]).jpeg({ quality: 91 }).toBuffer();
}

test("visual validation rejects parseable incomplete and refused provider responses", async () => {
  const passBody = JSON.stringify({
    decision: "PASS",
    hasVisibleText: false,
    hasLogoOrWatermark: false,
    observedText: null,
    issues: [],
  });
  await assert.rejects(
    () => validateArtworkOnlyVisual({
      buffer: Buffer.from("image"),
      dependencies: {
        openaiClient: {
          responses: {
            create: async () => ({
              id: "validation-incomplete-1",
              status: "incomplete",
              incomplete_details: { reason: "max_output_tokens" },
              output_text: passBody,
              usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
            }),
          },
        },
      },
    }),
    (error) => error.code === "social_artwork_only_validation_invalid"
      && error.validation_response.response_id === "validation-incomplete-1"
      && error.validation_response.usage.total_tokens === 16
      && error.validation_response.provider_status === "incomplete"
      && /^[a-f0-9]{64}$/.test(error.validation_response.output_fingerprint)
      && error.validation_response.raw_output_retained === false,
  );

  await assert.rejects(
    () => validateArtworkOnlyVisual({
      buffer: Buffer.from("image"),
      dependencies: {
        openaiClient: {
          responses: {
            create: async () => ({
              id: "validation-status-missing-1",
              output_text: passBody,
              usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
            }),
          },
        },
      },
    }),
    (error) => error.code === "social_artwork_only_validation_invalid"
      && error.validation_response.response_id === "validation-status-missing-1"
      && error.validation_response.provider_status === null
      && error.validation_response.raw_output_retained === false,
  );

  await assert.rejects(
    () => validateFullAiGraphicText({
      buffer: Buffer.from("image"),
      approvedHeadline: "Pause. Verify. Decide.",
      dependencies: {
        openaiClient: {
          responses: {
            create: async () => ({
              id: "validation-refusal-1",
              status: "completed",
              output: [{ content: [{ type: "refusal", refusal: "Unable to inspect this image" }] }],
              usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
            }),
          },
        },
      },
    }),
    (error) => error.code === "social_full_ai_graphic_validation_invalid"
      && error.validation_response.response_id === "validation-refusal-1"
      && error.validation_response.usage.total_tokens === 10
      && error.validation_response.raw_output_retained === false,
  );
});

function memoryAssetStore(records, prefix = "social") {
  return async ({ fileName, buffer }) => {
    const row = { fileName, buffer, checksum_sha256: checksum(buffer) };
    records.push(row);
    return {
      url: `https://media.pinkpaisa.test/${prefix}/${fileName}`,
      storage_provider: "external",
      storage_key: `${prefix}/${fileName}`,
      checksum_sha256: row.checksum_sha256,
    };
  };
}

function settings(maxImageRetries = 1) {
  return {
    models: {
      image_provider: "openai",
      image_model: "gpt-image-2",
      image_quality: "medium",
    },
    generation: { max_image_retries: maxImageRetries },
    cost_controls: { daily_image_generation_limit: 0 },
  };
}

function singleRecommendation({
  headline = "Make one money move today",
  imagePrompt = "Create an original premium Pink Paisa editorial scene of an Indian woman planning calmly at a warm contemporary desk with clean headline-safe space.",
} = {}) {
  const formatReason = "One focused action is clearest as a single portrait visual.";
  return {
    internalTitle: "One useful money move",
    topic: "A calm next step for money confidence",
    format: "SINGLE_IMAGE",
    formatReason,
    postType: "EDUCATIONAL",
    verifiedProductId: null,
    verifiedProductTitle: null,
    verifiedProductFacts: null,
    formatContent: {
      id: "primary",
      format: "SINGLE_IMAGE",
      postType: "EDUCATIONAL",
      objective: "EDUCATION",
      contentPillar: "Money Education",
      targetAudience: "Indian women building financial confidence",
      whyToday: "A small practical action is useful today.",
      formatReason,
      hookOptions: [headline, "A calmer money habit", "Start with one useful step"],
      caption: "Choose one small action and make it fit your real life.",
      cta: "Save this for your next money check-in.",
      hashtags: ["#PinkPaisa", "#MoneyConfidence", "#WomenAndMoney"],
      altText: "An Indian woman planning calmly at a warm desk.",
      recommendedLandingPage: "/quiz",
      sourceIndexes: [],
      financialDisclaimer: "Educational content only.",
      affiliateDisclosure: null,
      selectedHeadline: headline,
      supportingText: "Small steps can still build confidence.",
      imagePrompt,
      negativeVisualInstructions: ["No visible text, watermark, fake interface or unrelated logo."],
      overlayInstructions: {
        logoPosition: "Top-right safe area",
        headlinePosition: "Upper-left safe area",
        ctaPosition: "Lower-left safe area",
        disclosurePosition: "Bottom safe area",
        safeAreaNotes: "Keep the left third clear.",
      },
    },
    visualBrief: {
      id: "primary",
      format: "SINGLE_IMAGE",
      visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
      formatReason,
      aspectRatio: "4:5",
      subject: "An adult Indian woman calmly planning",
      setting: "A warm contemporary Indian home workspace",
      composition: "Subject on the right with clean negative space on the left",
      cameraAngle: "Natural eye-level three-quarter view",
      lighting: "Soft window light",
      palette: "Warm blush, plum, cream, muted coral and sage",
      mood: "Warm, capable and modern",
      indianCulturalContext: "Contemporary and natural without stereotypes",
      subjectRepresentationRequirements: ["Represent an adult Indian woman respectfully."],
      textSafeRegions: ["Upper-left third inside safe margins"],
      references: [],
      assets: [{
        sequence: 1,
        role: "FEED_VISUAL",
        imagePrompt,
        overlayInstructions: "Keep the upper-left region clear for approved copy.",
        requiredObjects: ["A notebook and pen"],
        prohibitedObjects: ["Visible text, watermarks, unrelated logos and fake interfaces"],
      }],
    },
  };
}

function carouselRecommendation(slideCount) {
  const recommendation = singleRecommendation();
  const slides = Array.from({ length: slideCount }, (_, index) => ({
    slideNumber: index + 1,
    headline: index === 0 ? "Three calmer money moves" : `Money move ${index + 1}`,
    body: `A useful, distinct action for slide ${index + 1}.`,
    imagePrompt: `Create distinct original Pink Paisa carousel scene ${index + 1} with a cohesive warm editorial art direction.`,
    overlayInstructions: "Keep the left text-safe region clear.",
  }));
  recommendation.format = "CAROUSEL";
  recommendation.formatContent = {
    ...recommendation.formatContent,
    format: "CAROUSEL",
    slideCount,
    narrativeArc: "Move from recognition to three practical actions.",
    cohesiveArtDirection: "One warm editorial system with a genuinely distinct scene for every slide.",
    slides,
  };
  recommendation.visualBrief = {
    ...recommendation.visualBrief,
    format: "CAROUSEL",
    assets: slides.map((slide, index) => ({
      sequence: index + 1,
      role: index === 0 ? "CAROUSEL_COVER" : "CAROUSEL_SLIDE",
      imagePrompt: slide.imagePrompt,
      overlayInstructions: slide.overlayInstructions,
      requiredObjects: [`Distinct scene object ${index + 1}`],
      prohibitedObjects: ["Visible text, watermarks, unrelated logos and duplicate compositions"],
    })),
  };
  return recommendation;
}

function productRecommendation() {
  const recommendation = singleRecommendation({
    headline: "A gentler way to plan your week",
    imagePrompt: "Create an original warm Pink Paisa desk scene around the supplied authentic wellness journal.",
  });
  const product = {
    id: "product-calm-journal",
    title: "Calm Wellness Journal",
    imageUrl: "https://media.pinkpaisa.test/products/calm-wellness-journal.png",
  };
  Object.assign(recommendation, {
    format: "PRODUCT_FEATURE",
    postType: "AFFILIATE",
    verifiedProductId: product.id,
    verifiedProductTitle: product.title,
    verifiedProductFacts: {
      id: product.id,
      title: product.title,
      brand: "Calm Co",
      category: "Healthy Lifestyle",
      subcategory: "Journals",
      asin: "B0CALM1234",
      imageUrl: product.imageUrl,
      description: "A guided journal for a reflective desk routine.",
      affiliateUrl: "https://www.amazon.in/dp/B0CALM1234?tag=pinkpaisa-21",
      landingPage: "/product/calm-wellness-journal",
    },
  });
  recommendation.formatContent = {
    ...recommendation.formatContent,
    format: "PRODUCT_FEATURE",
    postType: "AFFILIATE",
    verifiedProductId: product.id,
    verifiedProductTitle: product.title,
    verifiedProductImageUrl: product.imageUrl,
    productPreservationInstructions: [
      "Keep the physical journal, packaging, brand label, colour, proportions and variant unchanged.",
    ],
  };
  recommendation.visualBrief = {
    ...recommendation.visualBrief,
    format: "PRODUCT_FEATURE",
    authenticProductReference: {
      productId: product.id,
      productTitle: product.title,
      imageUrl: product.imageUrl,
      preservationInstruction: "Preserve the supplied product exactly; generate only its surrounding scene.",
    },
    assets: [{
      sequence: 1,
      role: "PRODUCT_SCENE",
      imagePrompt: recommendation.formatContent.imagePrompt,
      overlayInstructions: "Keep the upper-left region clear for approved copy.",
      requiredObjects: ["The supplied authentic Calm Wellness Journal"],
      prohibitedObjects: ["Replacement packaging, altered labels, prices, ratings and unrelated logos"],
    }],
  };
  return recommendation;
}

function draftFor(recommendation, key = "full-ai-image-test") {
  return {
    idempotency_key: key,
    generation_date: "2026-08-23",
    current_package: { primaryRecommendation: recommendation },
  };
}

test("final composition requires a validated OpenAI original and never silently enters template mode", async () => {
  const recommendation = singleRecommendation();
  const draft = draftFor(recommendation, "mandatory-original");
  let stores = 0;
  const neverStore = async () => {
    stores += 1;
    throw new Error("invalid input must not be stored");
  };

  await assert.rejects(
    renderSocialDraftAssets(draft, {
      recommendation,
      persist: false,
      storeCampaignAsset: neverStore,
    }),
    (error) => error.code === "ai_base_image_required",
  );
  await assert.rejects(
    renderSocialDraftAssets(draft, {
      recommendation,
      baseImage: await generatedImageBuffer(1),
      persist: false,
      storeCampaignAsset: neverStore,
    }),
    (error) => error.code === "social_original_ai_provenance_invalid",
  );
  await assert.rejects(
    renderSocialDraftAssets(draft, {
      recommendation,
      allowTemplateOnly: true,
      persist: false,
      storeCampaignAsset: neverStore,
    }),
    (error) => error.code === "manual_template_explicit_mode_required",
  );
  await assert.rejects(
    renderSocialDraftAssets(draft, {
      recommendation,
      manualTemplateMode: true,
      persist: false,
      storeCampaignAsset: neverStore,
    }),
    (error) => error.code === "manual_template_reason_required",
  );
  assert.equal(stores, 0);
});

test("carousel generation ignores the legacy zero daily-image cap and still enforces three to seven slides", async () => {
  const recommendation = carouselRecommendation(3);
  const calls = [];
  const stored = [];
  const result = await generateSocialVisuals({
    draftLike: draftFor(recommendation, "three-originals"),
    recommendation,
    settings: settings(1),
    dependencies: {
      generateOpenAiImage: async (input) => {
        calls.push(input);
        return {
          buffer: await generatedImageBuffer(calls.length),
          response_id: `image-request-${calls.length}`,
          usage: {},
        };
      },
      validateBrandLogoReference: async ({ contract }) => passingBrandLogoValidation(contract),
      storeCampaignAsset: memoryAssetStore(stored, "carousel-originals"),
    },
  });

  assert.equal(calls.length, 3);
  assert.equal(stored.length, 6);
  assert.equal(result.image_count, 3);
  assert.deepEqual(result.original_visuals.map((visual) => visual.sequence), [1, 2, 3]);
  assert.equal(new Set(result.original_visuals.map((visual) => visual.checksum_sha256)).size, 3);
  assert.ok(result.original_visuals.every((visual) => (
    visual.provider === "openai"
    && visual.model === "gpt-image-2"
    && visual.status === "VALIDATED"
    && visual.source_provenance === "generated_from_approved_source"
  )));

  for (const invalidCount of [2, 8]) {
    let invalidCalls = 0;
    const invalidRecommendation = carouselRecommendation(invalidCount);
    await assert.rejects(
      generateSocialVisuals({
        draftLike: draftFor(invalidRecommendation, `invalid-carousel-${invalidCount}`),
        recommendation: invalidRecommendation,
        settings: settings(1),
        dependencies: {
          generateOpenAiImage: async () => {
            invalidCalls += 1;
            return { buffer: await generatedImageBuffer(9), response_id: "must-not-run", usage: {} };
          },
        },
      }),
      (error) => error.code === "social_carousel_visual_count_invalid",
    );
    assert.equal(invalidCalls, 0);
  }
});

test("every image retry uses a materially revised AI prompt while preserving hard production constraints", async () => {
  const recommendation = singleRecommendation();
  const prompts = [];
  const revisions = [];
  const stored = [];
  const result = await generateSocialVisuals({
    draftLike: draftFor(recommendation, "revised-image-prompt"),
    recommendation,
    settings: settings(2),
    dependencies: {
      generateOpenAiImage: async (input) => {
        prompts.push(input.prompt);
        if (prompts.length === 1) {
          const error = new Error("temporary provider failure");
          error.status = 503;
          error.code = "provider_unavailable";
          throw error;
        }
        return { buffer: await generatedImageBuffer(4), response_id: "image-after-revision", usage: {} };
      },
      validateBrandLogoReference: async ({ contract }) => passingBrandLogoValidation(contract),
      reviseImagePrompt: async (input) => {
        revisions.push(input);
        return {
          prompt: "Create a revised Pink Paisa editorial scene with the subject seated by a bright window and a clearly different composition. Preserve only the approved visible wording.",
          response_id: "prompt-revision-1",
          usage: { input_tokens: 9, output_tokens: 7, total_tokens: 16 },
        };
      },
      sleep: async () => {},
      storeCampaignAsset: memoryAssetStore(stored, "revised-original"),
    },
  });

  assert.equal(prompts.length, 2);
  assert.equal(revisions.length, 1);
  assert.notEqual(prompts[1], prompts[0]);
  assert.match(prompts[1], /revised Pink Paisa editorial scene/i);
  assert.match(prompts[1], /Production constraints \(hard requirements\)/);
  assert.match(prompts[1], /Render no text/i);
  assert.equal(revisions[0].failure.code, "provider_unavailable");
  assert.equal(revisions[0].originalPrompt, recommendation.visualBrief.assets[0].imagePrompt);
  assert.doesNotMatch(revisions[0].originalPrompt, /Production constraints/);
  assert.doesNotMatch(revisions[0].failedAttemptFeedback.prompt, /Production constraints/);
  assert.equal(result.original_visuals[0].attempt_count, 2);
  assert.equal(result.original_visuals[0].failures[0].prompt_revision.status, "COMPLETED");
  assert.equal(result.original_visuals[0].failures[0].prompt_revision.provider_response_id, "prompt-revision-1");
});

test("paid retry success retains attempt rows and charges image calls plus prompt revision exactly once", async () => {
  const recommendation = singleRecommendation();
  const priorEnvironment = {
    image: process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE,
    input: process.env.SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION,
    output: process.env.SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION,
  };
  process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE = "0.25";
  process.env.SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION = "1";
  process.env.SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION = "2";
  try {
    let calls = 0;
    const result = await generateSocialVisuals({
      draftLike: draftFor(recommendation, "paid-retry-success"),
      recommendation,
      settings: settings(2),
      dependencies: {
        generateOpenAiImage: async () => {
          calls += 1;
          return calls === 1
            ? {
              buffer: Buffer.from("invalid-image-bytes"),
              response_id: "paid-image-rejected-1",
              usage: { input_tokens: 3, output_tokens: 0, total_tokens: 3 },
            }
            : {
              buffer: await generatedImageBuffer(25),
              response_id: "paid-image-accepted-2",
              usage: { input_tokens: 7, output_tokens: 0, total_tokens: 7 },
            };
        },
        validateBrandLogoReference: async ({ contract }) => passingBrandLogoValidation(contract),
        reviseImagePrompt: async () => imagePromptRevisionResult({
          output: { prompt: "Create a materially revised Pink Paisa scene beside a bright arched window." },
          provider: "openai",
          model: "gpt-5.6-luna",
          prompt_version: "social-image-prompt-revision-v2",
          response_id: "paid-prompt-revision-1",
          usage: { input_tokens: 1_000_000, output_tokens: 500_000, total_tokens: 1_500_000 },
          attempt_count: 1,
          attempts: [{
            attempt: 1,
            status: "SUCCEEDED",
            response_id: "paid-prompt-revision-1",
            usage: { input_tokens: 1_000_000, output_tokens: 500_000, total_tokens: 1_500_000 },
            output_fingerprint: "revision-output-fingerprint",
          }],
          input_fingerprint: "revision-input-fingerprint",
          output_fingerprint: "revision-output-fingerprint",
        }),
        sleep: async () => {},
        storeCampaignAsset: memoryAssetStore([], "paid-retry-success"),
      },
    });

    assert.equal(result.paid_image_call_count, 2);
    assert.equal(result.image_estimated_cost, 0.5);
    assert.equal(result.prompt_revision_estimated_cost, 2);
    assert.equal(result.estimated_cost, 2.5);
    assert.equal(result.usage.total_tokens, 1_500_010);
    const rows = imageAttemptRows(result, recommendation, "AI_VISUAL_WITH_EXACT_OVERLAY");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].provider_response_id, "paid-image-rejected-1");
    assert.equal(rows[0].prompt_revision.provider_response_id, "paid-prompt-revision-1");
    assert.equal(rows[0].prompt_revision.attempts[0].output_fingerprint, "revision-output-fingerprint");
    assert.equal(rows[0].usage.estimated_cost, 2.25);
    assert.equal(rows[1].provider_response_id, "paid-image-accepted-2");
    assert.equal(rows[1].usage.estimated_cost, 0.25);
  } finally {
    Object.entries(priorEnvironment).forEach(([key, value]) => {
      const environmentKey = {
        image: "SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE",
        input: "SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION",
        output: "SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION",
      }[key];
      if (value == null) delete process.env[environmentKey];
      else process.env[environmentKey] = value;
    });
  }
});

test("production rejects a missing image cost rate before any paid provider call", async () => {
  const priorNodeEnvironment = process.env.NODE_ENV;
  const priorRate = process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE;
  let imageCalls = 0;
  process.env.NODE_ENV = "production";
  delete process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE;
  try {
    await assert.rejects(
      generateSocialVisuals({
        draftLike: draftFor(singleRecommendation(), "missing-production-image-rate"),
        recommendation: singleRecommendation(),
        settings: settings(1),
        dependencies: {
          generateOpenAiImage: async () => {
            imageCalls += 1;
            return { buffer: await generatedImageBuffer(29), response_id: "must-not-run", usage: {} };
          },
          storeCampaignAsset: async () => { throw new Error("must not store an unpaid-cost image"); },
        },
      }),
      (error) => error.code === "social_image_cost_rate_not_configured"
        && error.statusCode === 503
        && error.retriable === false,
    );
    assert.equal(imageCalls, 0);
  } finally {
    if (priorNodeEnvironment == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnvironment;
    if (priorRate == null) delete process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE;
    else process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE = priorRate;
  }
});

test("a paid image that fails validation retains prompt, response, usage, and validation evidence", async () => {
  const recommendation = singleRecommendation();
  let stores = 0;
  await assert.rejects(
    generateSocialVisuals({
      draftLike: draftFor(recommendation, "failed-paid-image-evidence"),
      recommendation,
      settings: settings(1),
      dependencies: {
        generateOpenAiImage: async () => ({
          buffer: Buffer.from("invalid-image-bytes"),
          response_id: "paid-image-response-invalid",
          usage: { input_tokens: 17, output_tokens: 0, total_tokens: 17 },
        }),
        storeCampaignAsset: async () => {
          stores += 1;
          throw new Error("invalid image must not be stored");
        },
      },
    }),
    (error) => {
      assert.equal(error.code, "social_image_generation_failed");
      assert.equal(error.usage.total_tokens, 17);
      assert.equal(error.image_generation.paid_attempt_count, 1);
      assert.equal(error.image_generation.usage.total_tokens, 17);
      assert.match(error.image_generation.prompt, /Pink Paisa/i);
      assert.match(error.image_generation.prompt_fingerprint, /^[a-f0-9]{64}$/);
      assert.equal(error.image_generation.failures.length, 1);
      assert.equal(error.image_generation.failures[0].provider_response_id, "paid-image-response-invalid");
      assert.equal(error.image_generation.failures[0].usage.total_tokens, 17);
      assert.match(error.image_generation.failures[0].output_fingerprint, /^[a-f0-9]{64}$/);
      assert.equal(error.image_generation.failures[0].message, "AI image generation or validation attempt failed");
      assert.doesNotMatch(JSON.stringify(error.image_generation), /empty or too small/i);
      return true;
    },
  );
  assert.equal(stores, 0);
});

test("an invalid OpenAI image payload retains paid response metadata without raw bytes", async () => {
  await assert.rejects(
    callOpenAiImage({
      model: "gpt-image-2",
      prompt: "Create a safe Pink Paisa editorial visual.",
      size: "1088x1360",
      quality: "medium",
      dependencies: {
        openaiClient: {
          images: {
            generate: async () => ({
              id: "paid-invalid-image-response",
              usage: { input_tokens: 23, output_tokens: 0, total_tokens: 23 },
              data: [{}],
            }),
          },
        },
      },
    }),
    (error) => {
      assert.equal(error.code, "social_image_response_invalid");
      assert.equal(error.response_id, "paid-invalid-image-response");
      assert.equal(error.usage.total_tokens, 23);
      assert.match(error.output_fingerprint, /^[a-f0-9]{64}$/);
      assert.equal(Object.hasOwn(error, "buffer"), false);
      assert.equal(JSON.stringify(error).includes("b64_json"), false);
      return true;
    },
  );
});

test("accepted brand-logo validation usage is priced exactly once with its image call", async () => {
  const recommendation = singleRecommendation();
  recommendation.visualBrief.visualMode = "AI_BRANDED_ARTWORK";
  const priorEnvironment = {
    image: process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE,
    input: process.env.SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION,
    output: process.env.SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION,
  };
  process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE = "0.25";
  process.env.SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION = "1";
  process.env.SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION = "2";
  try {
    const result = await generateSocialVisuals({
      draftLike: draftFor(recommendation, "accepted-validator-cost"),
      recommendation,
      visualMode: "AI_BRANDED_ARTWORK",
      settings: settings(1),
      dependencies: {
        generateOpenAiImage: async () => ({
          buffer: await generatedImageBuffer(26),
          response_id: "accepted-artwork-image",
          usage: {},
        }),
        validateBrandLogoReference: async ({ contract }) => passingBrandLogoValidation(contract, {
          response_id: "accepted-artwork-validator",
          usage: { input_tokens: 1_000_000, output_tokens: 500_000, total_tokens: 1_500_000 },
        }),
        storeCampaignAsset: memoryAssetStore([], "accepted-validator-cost"),
      },
    });

    assert.equal(result.image_estimated_cost, 0.25);
    assert.equal(result.validation_estimated_cost, 2);
    assert.equal(result.prompt_revision_estimated_cost, 0);
    assert.equal(result.estimated_cost, 2.25);
    assert.equal(result.validation_usage.total_tokens, 1_500_000);
    const rows = imageAttemptRows(result, recommendation, "AI_BRANDED_ARTWORK");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].validation_usage.total_tokens, 1_500_000);
    assert.equal(rows[0].usage.estimated_cost, 2.25);
  } finally {
    if (priorEnvironment.image == null) delete process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE;
    else process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE = priorEnvironment.image;
    if (priorEnvironment.input == null) delete process.env.SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION;
    else process.env.SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION = priorEnvironment.input;
    if (priorEnvironment.output == null) delete process.env.SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION;
    else process.env.SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION = priorEnvironment.output;
  }
});

test("brand-logo validation cannot pass without a traceable provider response id", async () => {
  const recommendation = singleRecommendation();
  recommendation.visualBrief.visualMode = "AI_BRANDED_ARTWORK";
  await assert.rejects(
    () => generateSocialVisuals({
      draftLike: draftFor(recommendation, "artwork-validator-response-id"),
      recommendation,
      visualMode: "AI_BRANDED_ARTWORK",
      settings: settings(0),
      dependencies: {
        generateOpenAiImage: async () => ({
          buffer: await generatedImageBuffer(28),
          response_id: "artwork-image-with-id",
          usage: {},
        }),
        validateBrandLogoReference: async ({ contract }) => passingBrandLogoValidation(contract, {
          response_id: null,
          usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
        }),
        storeCampaignAsset: memoryAssetStore([], "untraceable-brand-validator"),
      },
    }),
    (error) => error.code === "social_brand_logo_validation_exhausted"
      && error.image_generation.failures.length === 3
      && error.image_generation.failures.every((failure) => failure.code === "social_brand_logo_validation_invalid"),
  );
});

test("malformed paid visual-validator output retains response evidence and validation cost without raw output", async () => {
  const recommendation = singleRecommendation();
  recommendation.visualBrief.visualMode = "AI_BRANDED_ARTWORK";
  const priorEnvironment = {
    image: process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE,
    input: process.env.SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION,
    output: process.env.SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION,
  };
  process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE = "0.25";
  process.env.SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION = "1";
  process.env.SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION = "2";
  try {
    await assert.rejects(
      generateSocialVisuals({
        draftLike: draftFor(recommendation, "malformed-validator-evidence"),
        recommendation,
        visualMode: "AI_BRANDED_ARTWORK",
        settings: settings(1),
        dependencies: {
          generateOpenAiImage: async () => ({
            buffer: await generatedImageBuffer(27),
            response_id: "malformed-validator-image",
            usage: {},
          }),
          openaiClient: {
            responses: {
              create: async () => ({
                id: "malformed-validator-response",
                status: "completed",
                output_text: "not-json-secret-provider-output",
                usage: { input_tokens: 1_000_000, output_tokens: 500_000, total_tokens: 1_500_000 },
              }),
            },
          },
          storeCampaignAsset: memoryAssetStore([], "malformed-brand-validator"),
        },
      }),
      (error) => {
        assert.equal(error.code, "social_brand_logo_validation_exhausted");
        assert.equal(error.image_generation.validation_usage.total_tokens, 4_500_000);
        assert.equal(error.image_generation.validation_estimated_cost, 6);
        assert.equal(error.image_generation.image_estimated_cost, 0.75);
        assert.equal(error.image_generation.estimated_cost, 6.75);
        const [failure] = error.image_generation.failures;
        assert.equal(failure.details.validation.response_id, "malformed-validator-response");
        assert.equal(failure.details.validation.usage.total_tokens, 1_500_000);
        assert.match(failure.details.validation.output_fingerprint, /^[a-f0-9]{64}$/);
        assert.equal(failure.details.validation.raw_output_retained, false);
        assert.doesNotMatch(JSON.stringify(error.image_generation), /not-json-secret-provider-output/);
        return true;
      },
    );
  } finally {
    if (priorEnvironment.image == null) delete process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE;
    else process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE = priorEnvironment.image;
    if (priorEnvironment.input == null) delete process.env.SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION;
    else process.env.SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION = priorEnvironment.input;
    if (priorEnvironment.output == null) delete process.env.SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION;
    else process.env.SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION = priorEnvironment.output;
  }
});

test("a terminal carousel failure retains prior paid visuals and retries without image bytes", async () => {
  const recommendation = carouselRecommendation(3);
  const priorRate = process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE;
  process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE = "0.2";
  try {
    let calls = 0;
    await assert.rejects(
      generateSocialVisuals({
        draftLike: draftFor(recommendation, "partial-carousel-failure"),
        recommendation,
        settings: settings(1),
        dependencies: {
          generateOpenAiImage: async () => {
            calls += 1;
            return {
              buffer: calls < 3 ? await generatedImageBuffer(30 + calls) : Buffer.from("invalid-image-bytes"),
              response_id: `partial-carousel-image-${calls}`,
              usage: { input_tokens: 10, output_tokens: 0, total_tokens: 10 },
            };
          },
          validateBrandLogoReference: async ({ contract }) => passingBrandLogoValidation(contract),
          storeCampaignAsset: memoryAssetStore([], "partial-carousel"),
        },
      }),
      (error) => {
        assert.equal(error.image_generation.completed_visuals.length, 2);
        assert.deepEqual(
          error.image_generation.completed_visuals.map((visual) => visual.response_id),
          ["partial-carousel-image-1", "partial-carousel-image-2"],
        );
        assert.equal(error.image_generation.failures[0].provider_response_id, "partial-carousel-image-3");
        assert.equal(error.image_generation.paid_image_call_count, 3);
        assert.equal(error.image_generation.usage.total_tokens, 30);
        assert.equal(error.image_generation.estimated_cost, 0.6);
        assert.equal(error.image_generation.raw_image_bytes_retained, false);
        const serialized = JSON.stringify(error.image_generation);
        assert.doesNotMatch(serialized, /"buffer"|invalid-image-bytes|data:image/i);
        return true;
      },
    );
  } finally {
    if (priorRate == null) delete process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE;
    else process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE = priorRate;
  }
});

test("FULL_AI_GRAPHIC retries failed complete-poster validation and persists v3 no-overlay bytes", async () => {
  const approvedHeadline = "Money can feel simpler";
  const recommendation = singleRecommendation({ headline: approvedHeadline });
  recommendation.visualBrief.visualMode = "FULL_AI_GRAPHIC";
  const imageCalls = [];
  const validationCalls = [];
  const originalStores = [];
  const promptRevisions = [];
  const result = await generateSocialVisuals({
    draftLike: draftFor(recommendation, "full-ai-graphic"),
    recommendation,
    settings: settings(2),
    visualMode: "FULL_AI_GRAPHIC",
    dependencies: {
      generateOpenAiImage: async (input) => {
        imageCalls.push(input);
        return {
          buffer: await generatedImageBuffer(10 + imageCalls.length),
          response_id: `full-graphic-image-${imageCalls.length}`,
          usage: {},
        };
      },
      validateFullAiGraphicPoster: async ({ expectedTextBlocks }) => {
        validationCalls.push(true);
        return validationCalls.length === 1
          ? {
            decision: "REGENERATE",
            exactTextMatch: false,
            brandIdentityMatch: true,
            mobileLegible: true,
            safeAreaPassed: true,
            unapprovedTextPresent: false,
            unrelatedLogoOrWatermarkPresent: false,
            observedTextBlocks: expectedTextBlocks.map((block) => (
              block.key === "headline" ? "Money can feels simpler" : block.text
            )),
            issues: ["The headline is not exact."],
            response_id: "visual-validator-1",
          }
          : {
            decision: "PASS",
            exactTextMatch: true,
            brandIdentityMatch: true,
            mobileLegible: true,
            safeAreaPassed: true,
            unapprovedTextPresent: false,
            unrelatedLogoOrWatermarkPresent: false,
            observedTextBlocks: expectedTextBlocks.map((block) => block.text),
            issues: [],
            response_id: "visual-validator-2",
          };
      },
      validateBrandLogoReference: async ({ contract }) => passingBrandLogoValidation(contract),
      reviseImagePrompt: async (input) => {
        promptRevisions.push(input);
        throw new Error("FULL_AI_GRAPHIC retries must not trust a free-form revised prompt");
      },
      sleep: async () => {},
      storeCampaignAsset: memoryAssetStore(originalStores, "full-graphic-original"),
    },
  });

  assert.equal(imageCalls.length, 2);
  assert.equal(validationCalls.length, 2);
  assert.equal(originalStores.length, 2);
  assert.equal(promptRevisions.length, 0);
  assert.equal((imageCalls[1].prompt.match(/Production constraints \(hard requirements\)/g) || []).length, 1);
  assert.equal((imageCalls[1].prompt.match(/\{"key":"supporting_text","text":"Small steps can still build confidence\."\}/g) || []).length, 1);
  assert.match(imageCalls[1].prompt, /Retry with a cleaner hierarchy/i);
  assert.deepEqual(result.original_visuals[0].poster_validation.observedTextBlocks, [
    approvedHeadline,
    "Small steps can still build confidence.",
  ]);
  assert.equal(result.original_visuals[0].poster_validation.validated_asset, "openai_normalized_final");
  assert.equal(result.original_visuals[0].full_ai_graphic_contract_version, 3);
  assert.equal(result.original_visuals[0].normalization.renderer, "sharp_resize_encode_only_v1");
  assert.equal(result.original_visuals[0].normalization.resize_fit, "fill");
  assert.equal(result.original_visuals[0].normalization.pixel_overlay_applied, false);
  assert.equal(result.original_visuals[0].failures[0].code, "social_full_ai_graphic_poster_invalid");
  assert.equal(result.original_visuals[0].failures[0].prompt_revision.status, "COMPLETED");
  assert.equal(result.original_visuals[0].failures[0].prompt_revision.method, "server_owned_full_ai_retry");

  const invalidOriginal = {
    ...result.original_visuals[0],
    poster_validation: {
      ...result.original_visuals[0].poster_validation,
      exactTextMatch: false,
      observedTextBlocks: ["Money can feels simpler", "Small steps can still build confidence."],
    },
  };
  let invalidStores = 0;
  await assert.rejects(
    renderSocialDraftAssets(draftFor(recommendation, "bad-full-graphic"), {
      recommendation,
      baseImages: [invalidOriginal],
      visualMode: "FULL_AI_GRAPHIC",
      persist: false,
      storeCampaignAsset: async () => {
        invalidStores += 1;
        throw new Error("an inexact graphic must not be stored");
      },
    }),
    (error) => error.code === "social_full_ai_graphic_poster_invalid",
  );
  assert.equal(invalidStores, 0);

  const finalStores = [];
  const composed = await renderSocialDraftAssets(draftFor(recommendation, "good-full-graphic"), {
    recommendation,
    baseImages: result.original_visuals,
    visualMode: "FULL_AI_GRAPHIC",
    sourceProvenance: "generated_without_reference",
    usageRightsStatus: "api_permitted",
    persist: false,
    storeCampaignAsset: memoryAssetStore(finalStores, "full-graphic-final"),
  });
  const asset = composed.assets[0];
  assert.equal(asset.visual_mode, "FULL_AI_GRAPHIC");
  assert.equal(finalStores.length, 1);
  assert.equal(asset.checksum_sha256, result.original_visuals[0].checksum_sha256);
  assert.equal(asset.renderer, "openai_generated_graphic_passthrough");
  assert.equal(asset.provenance.renderer, "openai_generated_graphic_passthrough");
  assert.equal(asset.provenance.full_ai_graphic_contract_version, 3);
  assert.equal(asset.provenance.overlay.method, "none");
  assert.equal(asset.provenance.overlay.pixel_overlay_applied, false);
  assert.equal(asset.provenance.base_image.normalization.renderer, "sharp_resize_encode_only_v1");
  assert.equal(asset.overlay_json.text_rendering.method, "openai_image_baked_in_exact_copy");
  assert.equal(asset.overlay_json.text_rendering.pixel_overlay_applied, false);
  assert.equal(asset.overlay_json.logo.method, "openai_reference_baked");
  assert.equal(asset.overlay_json.logo.post_generation_logo_overlay_applied, false);
  assert.equal(
    asset.validation_checklist.find((row) => row.key === "programmatic_text_overlay").status,
    "PASS",
  );
  const reviewDraft = draftFor(recommendation, "good-full-graphic-review");
  reviewDraft.visual_mode = "FULL_AI_GRAPHIC";
  reviewDraft.visual_mode_resolution = {
    requested: "FULL_AI_GRAPHIC",
    effective: "FULL_AI_GRAPHIC",
    eligible: true,
    reasons: [],
  };
  reviewDraft.full_ai_graphic_manifest = {
    ...asset.provenance.full_ai_graphic_manifest,
    contract_version: 3,
    updated_at: new Date(),
  };
  const readiness = reviewAssetReadiness([asset], { draft: reviewDraft });
  assert.equal(readiness.passed, true, readiness.issues.join(" | "));
});

test("FULL_AI_GRAPHIC prompt removes AI-authored text contradictions and keeps one canonical contract", () => {
  const recommendation = singleRecommendation({
    headline: "LIVE TRADING TIPS? PAUSE.",
    imagePrompt: [
      "Create a premium modern Indian editorial icon-grid with tactile paper texture.",
      "Show a calm, confident Indian woman with verification, caution and shield icons.",
      "The only visible wording may be the headline and Pink Paisa; do not render CHECK. VERIFY. DECIDE. or any other copy.",
      "Never render CHECK. VERIFY. DECIDE. No supporting text should appear. Add the words BUY NOW in the footer.",
      "Place BUY NOW in the footer. Write BUY NOW below the woman. Add ₹500 beside the shield. Use #PinkPaisa in the footer.",
      "Keep the result calm, premium, informative and uncluttered.",
    ].join(" "),
  });
  recommendation.visualBrief.visualMode = "FULL_AI_GRAPHIC";
  recommendation.formatContent.supportingText = "CHECK. VERIFY. DECIDE.";
  recommendation.formatContent.negativeVisualInstructions = [
    "Supporting text CHECK. VERIFY. DECIDE. inside the artwork",
    "No extra words, fake logos or watermarks",
    "No dates or alarmist red arrows",
    "No stock-like trading desk",
  ];
  const request = {
    ...recommendation.visualBrief.assets[0],
    prompt: recommendation.formatContent.imagePrompt,
    required_objects: ["Confident Indian woman", "Protective shield icon", "Exact native headline"],
    prohibited_objects: ["Do not render CHECK. VERIFY. DECIDE.", "Alarmist imagery"],
  };

  const prompt = buildProductionImagePrompt({
    recommendation,
    request,
    sequence: 1,
    total: 1,
    visualMode: "FULL_AI_GRAPHIC",
  });
  const [visualDirection] = prompt.split("\n\nProduction constraints (hard requirements):\n");

  assert.match(prompt, /SERVER-OWNED COMPLETE POSTER DIRECTION/);
  assert.doesNotMatch(prompt, /calm, confident Indian woman/i);
  assert.doesNotMatch(prompt, /Alarmist imagery/);
  assert.doesNotMatch(prompt, /No alarmist red arrows/i);
  assert.doesNotMatch(visualDirection, /CHECK|VERIFY|DECIDE|BUY NOW/i);
  assert.doesNotMatch(prompt, /only visible wording may/i);
  assert.doesNotMatch(prompt, /do not render CHECK\. VERIFY\. DECIDE/i);
  assert.doesNotMatch(prompt, /Supporting text CHECK\. VERIFY\. DECIDE\. inside the artwork/i);
  assert.doesNotMatch(prompt, /Never render/i);
  assert.doesNotMatch(prompt, /No supporting text/i);
  assert.doesNotMatch(prompt, /BUY NOW/i);
  assert.doesNotMatch(prompt, /₹500|#PinkPaisa/i);
  assert.doesNotMatch(prompt, /APPROVED_TEXT_BLOCK/i);
  assert.doesNotMatch(prompt, /No dates/i);
  assert.match(prompt, /\{"key":"supporting_text","text":"CHECK\. VERIFY\. DECIDE\."\}/);
  assert.equal((prompt.match(/CHECK\. VERIFY\. DECIDE\./g) || []).length, 1);
});

test("FULL_AI_GRAPHIC Story prompt bakes frame copy, final CTA, disclaimer and sequence into the original image", () => {
  const recommendation = singleRecommendation();
  recommendation.format = "STORY";
  recommendation.formatContent = {
    ...recommendation.formatContent,
    format: "STORY",
    cta: "Visit the Wealthness Quiz.",
    financialDisclaimer: "Educational content only. Not personalised financial advice.",
    frames: [
      { frameNumber: 1, copy: "Which money idea should we explain next?" },
      { frameNumber: 2, copy: "Choose one topic and begin with a clear explanation." },
    ],
  };
  recommendation.visualBrief = {
    ...recommendation.visualBrief,
    format: "STORY",
    visualMode: "FULL_AI_GRAPHIC",
    aspectRatio: "9:16",
    assets: [1, 2].map((sequence) => ({
      sequence,
      role: "STORY_FRAME",
      prompt: `Create native Story frame ${sequence}.`,
      imagePrompt: `Create native Story frame ${sequence}.`,
      overlayInstructions: "No post-generation overlay.",
      requiredObjects: [],
      prohibitedObjects: [],
    })),
  };

  const blocks = fullAiGraphicTextBlocksForSequence(recommendation, 2, 2, { contractVersion: 3 });
  assert.deepEqual(blocks, [
    { key: "story_copy", text: "Choose one topic and begin with a clear explanation." },
    { key: "cta", text: "Visit the Wealthness Quiz." },
    { key: "financial_disclaimer", text: "Educational content only. Not personalised financial advice." },
    { key: "sequence_label", text: "2/2" },
  ]);
  const prompt = buildProductionImagePrompt({
    recommendation,
    request: recommendation.visualBrief.assets[1],
    sequence: 2,
    total: 2,
    visualMode: "FULL_AI_GRAPHIC",
  });
  assert.match(prompt, /Stories publish without a caption/);
  assert.match(prompt, /do not add any post-generation overlay/i);
  for (const block of blocks) assert.equal(prompt.split(JSON.stringify(block)).length - 1, 1);
});

test("FULL_AI_GRAPHIC Story finals are AI-native byte passthrough with no programmatic overlay", async () => {
  const recommendation = singleRecommendation();
  recommendation.format = "STORY";
  recommendation.formatContent = {
    ...recommendation.formatContent,
    format: "STORY",
    cta: "Visit the Wealthness Quiz.",
    financialDisclaimer: "Educational content only. Not personalised financial advice.",
    frames: [
      { frameNumber: 1, copy: "Which money idea should we explain next?" },
      { frameNumber: 2, copy: "Choose one topic and begin with a clear explanation." },
    ],
  };
  recommendation.visualBrief = {
    ...recommendation.visualBrief,
    format: "STORY",
    visualMode: "FULL_AI_GRAPHIC",
    aspectRatio: "9:16",
    assets: [1, 2].map((sequence) => ({
      sequence,
      role: "STORY_FRAME",
      prompt: `Create native Story frame ${sequence}.`,
      imagePrompt: `Create native Story frame ${sequence}.`,
      overlayInstructions: "No post-generation overlay.",
      requiredObjects: [],
      prohibitedObjects: [],
    })),
  };
  const originalStores = [];
  let imageCall = 0;
  const generated = await generateSocialVisuals({
    draftLike: draftFor(recommendation, "native-story"),
    recommendation,
    settings: settings(1),
    visualMode: "FULL_AI_GRAPHIC",
    dependencies: {
      generateOpenAiImage: async () => ({
        buffer: await generatedImageBuffer(++imageCall),
        response_id: `native-story-image-${imageCall}`,
        usage: {},
      }),
      validateFullAiGraphicPoster: async ({ expectedTextBlocks }) => ({
        decision: "PASS",
        exactTextMatch: true,
        brandIdentityMatch: true,
        mobileLegible: true,
        safeAreaPassed: true,
        unapprovedTextPresent: false,
        unrelatedLogoOrWatermarkPresent: false,
        observedTextBlocks: expectedTextBlocks.map((block) => block.text),
        issues: [],
        response_id: `native-story-validator-${imageCall}`,
      }),
      validateBrandLogoReference: async ({ contract }) => passingBrandLogoValidation(contract, {
        response_id: `native-story-logo-validator-${imageCall}`,
      }),
      sleep: async () => {},
      storeCampaignAsset: memoryAssetStore(originalStores, "native-story-original"),
    },
  });
  const finalStores = [];
  const rendered = await renderSocialDraftAssets(draftFor(recommendation, "native-story-final"), {
    recommendation,
    baseImages: generated.original_visuals,
    visualMode: "FULL_AI_GRAPHIC",
    sourceProvenance: "generated_without_reference",
    usageRightsStatus: "api_permitted",
    persist: false,
    storeCampaignAsset: memoryAssetStore(finalStores, "native-story-final"),
  });

  assert.equal(rendered.assets.length, 2);
  for (const [index, asset] of rendered.assets.entries()) {
    assert.equal(asset.checksum_sha256, generated.original_visuals[index].checksum_sha256);
    assert.equal(asset.renderer, "openai_generated_graphic_passthrough");
    assert.equal(asset.provenance.overlay.method, "none");
    assert.equal(asset.provenance.overlay.pixel_overlay_applied, false);
    assert.equal(asset.provenance.caption_policy.method, "story_frame_ai_native");
    assert.equal(asset.provenance.caption_policy.pixel_overlay_applied, false);
    assert.equal(asset.overlay_json.text_rendering.method, "openai_image_baked_in_exact_copy");
    assert.equal(asset.validation_checklist.find((row) => row.key === "story_frame_disclosure_policy")?.status, "PASS");
  }
  const reviewDraft = draftFor(recommendation, "native-story-review");
  reviewDraft.visual_mode = "FULL_AI_GRAPHIC";
  reviewDraft.visual_mode_resolution = {
    requested: "FULL_AI_GRAPHIC",
    effective: "FULL_AI_GRAPHIC",
    eligible: true,
    reasons: [],
  };
  reviewDraft.full_ai_graphic_manifest = fullAiDraftManifestFromAssets(rendered.assets);
  const readiness = reviewAssetReadiness(rendered.assets, { draft: reviewDraft });
  assert.equal(readiness.passed, true, readiness.issues.join(" | "));
});

test("product generation preserves the exact authentic reference from prompt through final provenance", async () => {
  const recommendation = productRecommendation();
  const referenceBuffer = await sharp({
    create: {
      width: 900,
      height: 900,
      channels: 3,
      background: { r: 241, g: 225, b: 205 },
    },
  }).png().toBuffer();
  const referenceChecksum = checksum(referenceBuffer);
  const imageCalls = [];
  const originalStores = [];
  const result = await generateSocialVisuals({
    draftLike: draftFor(recommendation, "authentic-product"),
    recommendation,
    settings: settings(1),
    dependencies: {
      getVerifiedProductRecord: async () => ({
        _id: recommendation.verifiedProductFacts.id,
        title: recommendation.verifiedProductFacts.title,
        status: "active",
        is_visible: true,
        archived_at: null,
        is_affiliate: true,
        affiliate_is_instagram_pick: true,
        affiliate_link_check_status: "ok",
        affiliate_compliance_status: "compliant",
        affiliate_campaign_usage_rights: "admin_confirmed",
        affiliate_campaign_asset_url: recommendation.verifiedProductFacts.imageUrl,
        affiliate_image_provenance: "admin_provided",
      }),
      readAndNormalizeReferenceImage: async (url) => ({
        buffer: referenceBuffer,
        source_url: url,
        checksum_sha256: referenceChecksum,
        mime_type: "image/png",
      }),
      generateOpenAiImage: async (input) => {
        imageCalls.push(input);
        return { buffer: await generatedImageBuffer(20), response_id: "product-image-1", usage: {} };
      },
      validateBrandLogoReference: async ({ contract }) => passingBrandLogoValidation(contract),
      storeCampaignAsset: memoryAssetStore(originalStores, "product-original"),
    },
  });

  const productUrl = recommendation.verifiedProductFacts.imageUrl;
  assert.equal(Object.hasOwn(imageCalls[0], "reference"), false);
  assert.match(imageCalls[0].prompt, /BACKGROUND ONLY/i);
  assert.match(imageCalls[0].prompt, /OpenAI must never receive or transform its pixels/i);
  assert.equal(result.original_visuals[0].source_provenance, "generated_from_approved_source");
  assert.equal(result.original_visuals[0].reference_image_url, productUrl);
  assert.equal(result.original_visuals[0].reference_image_checksum_sha256, referenceChecksum);
  assert.equal(result.original_visuals[0].authentic_product_reference.checksum_sha256, referenceChecksum);
  assert.equal(result.original_visuals[0].authentic_product_reference.original_database_url, productUrl);
  assert.equal(result.original_visuals[0].authentic_product_composition.product_pixels_generated_by_ai, false);
  assert.equal(result.original_visuals[0].authentic_product_composition.packaging_editing_performed, false);
  assert.equal(result.original_visuals[0].authentic_product_composition.placement.occurrence_count, 1);
  const storedReference = originalStores.find((row) => row.fileName.includes("authentic-product-reference"));
  assert.ok(storedReference);
  assert.equal(storedReference.buffer.equals(referenceBuffer), true);
  assert.equal(checksum(storedReference.buffer), referenceChecksum);
  assert.equal(originalStores.some((row) => row.fileName.includes("ai-background")), true);
  assert.equal(originalStores.some((row) => row.fileName.includes("authentic-product-composite")), true);

  const finalStores = [];
  const composed = await renderSocialDraftAssets(draftFor(recommendation, "authentic-product-final"), {
    recommendation,
    baseImages: result.original_visuals,
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    usageRightsStatus: "api_permitted",
    persist: false,
    storeCampaignAsset: memoryAssetStore(finalStores, "product-final"),
  });
  const reference = composed.assets[0].reference_assets.find((row) => row.reference_type === "PRODUCT_IMAGE");
  assert.equal(reference.reference_type, "PRODUCT_IMAGE");
  assert.equal(reference.url, productUrl);
  assert.equal(reference.checksum_sha256, referenceChecksum);
  assert.equal(reference.authenticity_must_be_preserved, true);
  assert.equal(reference.source_bytes_preserved, true);
  assert.equal(reference.database_record_verified, true);
  assert.equal(composed.assets[0].provenance.base_image.reference_image_url, productUrl);
  assert.equal(composed.assets[0].provenance.base_image.type, "openai_background_with_authentic_product_composite");
  assert.equal(composed.assets[0].manual_review_required, true);
  assert.equal(reviewAssetReadiness(composed.assets).passed, true);
  const tamperedAsset = JSON.parse(JSON.stringify(composed.assets[0]));
  tamperedAsset.reference_assets.find((row) => row.reference_type === "PRODUCT_IMAGE").checksum_sha256 = "0".repeat(64);
  assert.equal(reviewAssetReadiness([tamperedAsset]).passed, false);

  const mismatched = JSON.parse(JSON.stringify(recommendation));
  mismatched.formatContent.verifiedProductImageUrl = "https://media.pinkpaisa.test/products/fake-replacement.png";
  let mismatchedCalls = 0;
  await assert.rejects(
    generateSocialVisuals({
      draftLike: draftFor(mismatched, "mismatched-product"),
      recommendation: mismatched,
      settings: settings(1),
      dependencies: {
        generateOpenAiImage: async () => {
          mismatchedCalls += 1;
          return { buffer: await generatedImageBuffer(21), response_id: "must-not-run", usage: {} };
        },
      },
    }),
    (error) => error.code === "social_product_reference_mismatch",
  );
  assert.equal(mismatchedCalls, 0);
});

test("final assets retain independently verifiable original and final AI provenance", async () => {
  const recommendation = singleRecommendation();
  const originalStores = [];
  const generated = await generateSocialVisuals({
    draftLike: draftFor(recommendation, "provenance-original"),
    recommendation,
    settings: settings(1),
    dependencies: {
      generateOpenAiImage: async () => ({
        buffer: await generatedImageBuffer(30),
        response_id: "provenance-image-response",
        usage: { input_tokens: 12, output_tokens: 0, total_tokens: 12 },
      }),
      validateBrandLogoReference: async ({ contract }) => passingBrandLogoValidation(contract),
      storeCampaignAsset: memoryAssetStore(originalStores, "provenance-original"),
    },
  });
  const original = generated.original_visuals[0];
  const replacementOriginalBuffer = await generatedImageBuffer(98);
  const replacementOriginal = {
    ...original,
    buffer: replacementOriginalBuffer,
    checksum_sha256: checksum(replacementOriginalBuffer),
  };
  await assert.rejects(
    () => renderSocialDraftAssets(draftFor(recommendation, "provenance-replaced-base"), {
      recommendation,
      baseImages: [replacementOriginal],
      visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
      sourceProvenance: "generated_without_reference",
      usageRightsStatus: "api_permitted",
      persist: false,
      storeCampaignAsset: memoryAssetStore([], "provenance-replaced-base"),
    }),
    (error) => error.code === "social_brand_logo_evidence_invalid",
  );
  const finalStores = [];
  const composed = await renderSocialDraftAssets(draftFor(recommendation, "provenance-final"), {
    recommendation,
    baseImages: [original],
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    sourceProvenance: "generated_without_reference",
    usageRightsStatus: "api_permitted",
    persist: false,
    storeCampaignAsset: memoryAssetStore(finalStores, "provenance-final"),
  });
  const final = composed.assets[0];

  assert.equal(final.asset_role, "FINAL_COMPOSED");
  assert.equal(final.image_generation_status, "VALIDATED");
  assert.equal(final.image_provider, "openai");
  assert.equal(final.image_model, "gpt-image-2");
  assert.equal(final.provider_response_id, "provenance-image-response");
  assert.equal(final.original_asset_url, original.provider_original.url);
  assert.deepEqual(final.original_visual, {
    url: original.provider_original.url,
    storage_provider: original.provider_original.storage_provider,
    storage_key: original.provider_original.storage_key,
    checksum_sha256: original.provider_original.checksum_sha256,
    mime_type: original.provider_original.mime_type,
    file_size_bytes: original.provider_original.file_size_bytes,
    width: original.provider_original.width,
    height: original.provider_original.height,
  });
  assert.equal(final.provenance.base_image.checksum_sha256, original.checksum_sha256);
  assert.equal(final.provenance.base_image.normalized_asset_url, original.url);
  assert.equal(final.provenance.base_image.provider_original.checksum_sha256, original.provider_original.checksum_sha256);
  assert.equal(final.provenance.base_image.type, "openai_generated_original_visual");
  assert.equal(final.provenance.base_image.generation_status, "VALIDATED");
  assert.equal(final.brand_logo_evidence.validated_asset, "openai_normalized_final");
  assert.equal(final.brand_logo_evidence.final_asset_preservation.final_asset_role, "final_publishable_asset");
  assert.equal(final.brand_logo_evidence.validated_asset_checksum_sha256, original.checksum_sha256);
  assert.equal(
    final.brand_logo_evidence.final_asset_preservation.source_validated_asset_checksum_sha256,
    original.checksum_sha256,
  );
  assert.equal(final.overlay_json.copy_source_path, "formatContent");
  assert.equal(final.overlay_json.approved_copy.selectedHeadline, recommendation.formatContent.selectedHeadline);
  assert.match(final.checksum_sha256, /^[a-f0-9]{64}$/);
  assert.equal(final.checksum_sha256, checksum(finalStores[0].buffer));
  assert.equal(
    final.brand_logo_evidence.final_asset_preservation.final_publishable_asset_checksum_sha256,
    final.checksum_sha256,
  );
  assert.notEqual(final.checksum_sha256, original.checksum_sha256);

  const replacementBuffer = await generatedImageBuffer(99);
  const replacementAsset = JSON.parse(JSON.stringify(final));
  replacementAsset.checksum_sha256 = checksum(replacementBuffer);
  const replacementValidation = await validateSocialAsset(replacementAsset, {
    buffer: replacementBuffer,
    expectedWidth: 1080,
    expectedHeight: 1350,
    expectedCopy: final.overlay_json.approved_copy,
  });
  assert.equal(
    replacementValidation.validation_checklist.find((row) => row.key === "mandatory_ai_baked_brand_logo")?.status,
    "FAIL",
  );
  assert.equal(
    replacementValidation.validation_checklist.find((row) => row.key === "final_asset_logo_preservation")?.status,
    "FAIL",
  );
});
