const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const sharp = require("sharp");

const {
  AI_BRANDED_ARTWORK_MODE,
  BRAND_LOGO_POLICY,
  CANONICAL_BRAND_BADGE_ID,
  CANONICAL_BRAND_BADGE_SHA256,
  attachVerifiedBrandLogoReadiness,
  brandLogoEvidencePassed,
  buildBrandLogoContract,
  chooseBrandLogoCorner,
  serializeBrandLogoContract,
  verifyBrandLogoReference,
} = require("../services/social/socialBrandLogoPolicy");
const {
  buildProductionImagePrompt,
  callOpenAiImage,
  generateSocialVisuals,
  stageSuppliedFullAiGraphic,
  validateBrandLogoReference,
  _private: { fullAiGraphicTextBlocksForSequence },
} = require("../services/social/socialAiImageService");
const {
  _private: { buildBrandBaseSvg, buildCopyOverlaySvg, calculateTextLayout },
} = require("../services/socialCreativeService");

function checksum(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function generatedImageBuffer(seed = 1) {
  return sharp({
    create: {
      width: 1200,
      height: 1500,
      channels: 3,
      background: { r: 80 + seed, g: 30 + seed, b: 120 + seed },
    },
  }).jpeg({ quality: 91 }).toBuffer();
}

function recommendation(visualMode = AI_BRANDED_ARTWORK_MODE) {
  return {
    topic: "A calm money habit",
    format: "SINGLE_IMAGE",
    objective: "EDUCATION",
    postType: "EDUCATIONAL",
    contentPillar: "Money Education",
    formatContent: {
      format: "SINGLE_IMAGE",
      objective: "EDUCATION",
      postType: "EDUCATIONAL",
      contentPillar: "Money Education",
      selectedHeadline: "Pause before you pay",
      supportingText: "Check the recipient and amount once more.",
      caption: "A calm check can prevent a rushed money mistake.",
      cta: "Save this reminder.",
      hashtags: ["#PinkPaisa", "#MoneySafety"],
      financialDisclaimer: "Educational content only.",
      affiliateDisclosure: null,
      overlayInstructions: {
        logoPosition: "Top-right safe area",
        headlinePosition: "Upper-left safe area",
      },
    },
    visualBrief: {
      format: "SINGLE_IMAGE",
      visualMode,
      visuals: [{
        sequence: 1,
        imagePrompt: "Create a bold premium editorial illustration about checking a digital payment before sending it.",
        overlayInstructions: "Keep the upper-left area clear for approved copy.",
        requiredObjects: ["A calm Indian woman", "A verification symbol"],
        prohibitedObjects: ["Unapproved words", "Other logos"],
      }],
    },
  };
}

function passingEvidence(contract, responseId = "logo-validation-1") {
  const serialized = serializeBrandLogoContract(contract);
  const box = serialized.safe_corner.target_box;
  return {
    decision: "PASS",
    badgeId: CANONICAL_BRAND_BADGE_ID,
    referenceChecksumSha256: CANONICAL_BRAND_BADGE_SHA256,
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
    observedCorner: serialized.locked_corner,
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
    issues: [],
    response_id: responseId,
    usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
    post_generation_logo_overlay_applied: false,
  };
}

test("canonical badge contract verifies exact PNG identity and locks a compliant draft corner", async () => {
  const reference = await verifyBrandLogoReference();
  assert.equal(reference.badge_id, CANONICAL_BRAND_BADGE_ID);
  assert.equal(reference.checksum_sha256, CANONICAL_BRAND_BADGE_SHA256);
  assert.equal(reference.mime_type, "image/png");
  assert.equal(reference.width, 512);
  assert.equal(reference.height, 512);
  assert.equal(reference.has_alpha, true);
  assert.equal(checksum(reference.buffer), CANONICAL_BRAND_BADGE_SHA256);

  const draftLike = { idempotency_key: "same-draft-for-every-slide" };
  const first = chooseBrandLogoCorner({ draftLike, recommendation: recommendation() });
  const second = chooseBrandLogoCorner({ draftLike, recommendation: recommendation() });
  assert.deepEqual(second, first);
  assert.equal(first.corner, "TOP_RIGHT");
  assert.equal(first.target_box.width, 210);
  assert.ok(first.target_box.left >= 64);
  assert.ok(first.target_box.left + first.target_box.width <= 1016);

  const contract = await buildBrandLogoContract({ draftLike, recommendation: recommendation() });
  const serialized = serializeBrandLogoContract(contract);
  assert.equal(serialized.policy_version, "pink-paisa-mandatory-ai-baked-v1");
  assert.equal(serialized.required, true);
  assert.equal(serialized.method, "AI_REFERENCE_BAKED");
  assert.equal(serialized.reference_asset_id, CANONICAL_BRAND_BADGE_ID);
  assert.equal(serialized.reference_checksum_sha256, CANONICAL_BRAND_BADGE_SHA256);
  assert.equal(serialized.placement_strategy, "ADAPTIVE_SAFE_CORNER_LOCKED_PER_DRAFT");
  assert.equal(serialized.target_width_px, 210);
  assert.deepEqual(serialized.accepted_width_range_px, [180, 240]);
  assert.equal(serialized.readiness_status, "VERIFIED");
  assert.equal(serialized.post_generation_logo_overlay_applied, false);
  assert.equal(Object.hasOwn(serialized, "buffer"), false);
  assert.equal(BRAND_LOGO_POLICY.reference_checksum_sha256, CANONICAL_BRAND_BADGE_SHA256);
});

test("Setup readiness reflects a live canonical badge verification instead of static policy intent", async () => {
  const settings = {
    visual_brand: {
      use_logo: true,
      logo_policy: { readiness_status: "VERIFY_BEFORE_GENERATION" },
    },
  };
  const ready = await attachVerifiedBrandLogoReadiness(settings);
  assert.equal(ready.visual_brand.logo_policy.readiness_status, "VERIFIED");
  assert.equal(ready.visual_brand.logo_policy.reference_checksum_sha256, CANONICAL_BRAND_BADGE_SHA256);
  assert.equal(ready.visual_brand.logo_policy.reference_url, "/pink-paisa-logo.png");

  const failed = await attachVerifiedBrandLogoReadiness(settings, {
    dependencies: { readFile: async () => Buffer.from("not-the-approved-logo") },
  });
  assert.equal(failed.visual_brand.logo_policy.readiness_status, "FAILED");
  assert.equal(failed.visual_brand.logo_policy.readiness_error_code, "social_brand_logo_reference_invalid");
});

test("weekly approval contract survives the generation worker identity without changing its frozen lock", async () => {
  const weeklyContract = await buildBrandLogoContract({
    draftLike: { idempotency_key: "weekly:plan-1:candidate-1:v5" },
    recommendation: recommendation("AI_VISUAL_WITH_EXACT_OVERLAY"),
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
  });
  const frozen = serializeBrandLogoContract(weeklyContract);

  const workerContract = await buildBrandLogoContract({
    draftLike: {
      _id: "generation-run-1",
      idempotency_key: "social-draft:generation-run-1",
      brand_logo_contract: frozen,
    },
    recommendation: recommendation("AI_VISUAL_WITH_EXACT_OVERLAY"),
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
  });
  const workerFrozen = serializeBrandLogoContract(workerContract);

  assert.equal(workerFrozen.locked_corner, frozen.locked_corner);
  assert.equal(workerFrozen.safe_corner.lock_id, frozen.safe_corner.lock_id);
  assert.deepEqual(workerFrozen.safe_corner.target_box, frozen.safe_corner.target_box);

  await assert.rejects(
    () => buildBrandLogoContract({
      draftLike: {
        idempotency_key: "social-draft:generation-run-tampered",
        brand_logo_contract: {
          ...frozen,
          safe_corner: {
            ...frozen.safe_corner,
            target_box: {
              ...frozen.safe_corner.target_box,
              top: frozen.safe_corner.target_box.top + 1,
            },
          },
        },
      },
      recommendation: recommendation("AI_VISUAL_WITH_EXACT_OVERLAY"),
      visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    }),
    (error) => error.code === "social_brand_logo_contract_mismatch",
  );
});

test("Story and Reel safe boxes honor platform exclusion edges and fail closed when every corner is occupied", () => {
  const story = chooseBrandLogoCorner({
    draftLike: { idempotency_key: "story-safe-box" },
    recommendation: { format: "STORY", topic: "Story" },
    preferredCorner: "BOTTOM_RIGHT",
  });
  assert.equal(story.target_box.width, 210);
  assert.ok(story.target_box.top >= 250);
  assert.ok(story.target_box.top + story.target_box.height <= 1670);

  const reel = chooseBrandLogoCorner({
    draftLike: { idempotency_key: "reel-safe-box" },
    recommendation: { format: "REEL", topic: "Reel" },
    preferredCorner: "BOTTOM_RIGHT",
  });
  assert.ok(reel.target_box.left + reel.target_box.width <= 920);
  assert.ok(reel.target_box.top + reel.target_box.height <= 1500);

  assert.throws(
    () => chooseBrandLogoCorner({
      draftLike: { idempotency_key: "no-safe-corner" },
      recommendation: {
        format: "SINGLE_IMAGE",
        visualBrief: {
          overlayInstructions: {
            headlinePosition: "top left",
            sublinePosition: "top right",
            ctaPosition: "bottom left",
            disclosurePosition: "bottom right",
          },
        },
      },
    }),
    (error) => error.code === "social_brand_logo_safe_corner_unavailable",
  );
});

test("exact-copy composition reserves and masks the frozen badge corner", async () => {
  const exactRecommendation = recommendation("AI_VISUAL_WITH_EXACT_OVERLAY");
  const contract = await buildBrandLogoContract({
    draftLike: { idempotency_key: "exact-overlay-safe-corner" },
    recommendation: exactRecommendation,
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
  });
  assert.equal(contract.safe_corner.corner, "BOTTOM_RIGHT");

  const layout = calculateTextLayout({
    width: 1080,
    height: 1350,
    headline: exactRecommendation.formatContent.selectedHeadline,
    body: exactRecommendation.formatContent.supportingText,
    artDirection: "BOLD_EDITORIAL_COLLAGE",
    socialFormat: "SINGLE_IMAGE",
  });
  const safeBox = contract.safe_corner.target_box;
  const baseSvg = buildBrandBaseSvg({
    width: 1080,
    height: 1350,
    hasBaseImage: true,
    artDirection: "BOLD_EDITORIAL_COLLAGE",
    brandLogoSafeBox: safeBox,
  }).toString();
  const copySvg = buildCopyOverlaySvg({
    width: 1080,
    height: 1350,
    layout,
    sequence: 1,
    total: 1,
    artDirection: "BOLD_EDITORIAL_COLLAGE",
    brandLogoSafeBox: safeBox,
  }).toString();

  assert.match(baseSvg, /brandLogoBaseSafeExclusion/);
  assert.match(copySvg, /brandLogoCopySafeExclusion/);
  assert.match(baseSvg, new RegExp(`x="${safeBox.left - 24}"`));
  assert.match(copySvg, /programmatic|<mask/i);
});

test("tampered canonical source fails closed before a paid image call", async () => {
  const canonical = await verifyBrandLogoReference();
  const tampered = Buffer.from(canonical.buffer);
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(
    () => verifyBrandLogoReference({
      logoPath: "ignored-by-test.png",
      dependencies: { readFile: async () => tampered },
    }),
    (error) => error.code === "social_brand_logo_reference_invalid" && /checksum/i.test(error.message),
  );

  let paidCalls = 0;
  await assert.rejects(
    () => generateSocialVisuals({
      draftLike: { idempotency_key: "invalid-logo-preflight" },
      recommendation: recommendation("AI_VISUAL_WITH_EXACT_OVERLAY"),
      visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
      settings: { models: { image_provider: "openai", image_model: "gpt-image-2" } },
      dependencies: {
        buildBrandLogoContract: async () => {
          const error = new Error("bad canonical bytes");
          error.code = "social_brand_logo_reference_invalid";
          throw error;
        },
        generateOpenAiImage: async () => { paidCalls += 1; },
      },
    }),
    (error) => error.code === "social_brand_logo_reference_invalid",
  );
  assert.equal(paidCalls, 0);
});

test("OpenAI gateway uses one automatically high-fidelity logo Uploadable with gpt-image-2 images.edit", async () => {
  const contract = await buildBrandLogoContract({
    draftLike: { idempotency_key: "edit-gateway" },
    recommendation: recommendation(),
  });
  const output = Buffer.from("generated-output");
  let editPayload = null;
  let generateCalls = 0;
  let upload = null;
  const result = await callOpenAiImage({
    model: "gpt-image-2",
    prompt: "Create the approved branded artwork.",
    size: "1088x1360",
    quality: "medium",
    brandLogoContract: contract,
    dependencies: {
      openaiClient: {
        images: {
          generate: async () => { generateCalls += 1; throw new Error("must not generate without the reference"); },
          edit: async (payload) => {
            editPayload = payload;
            return {
              id: "image-edit-response-1",
              data: [{ b64_json: output.toString("base64") }],
              usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
            };
          },
        },
      },
      toOpenAiFile: async (buffer, name, options) => {
        upload = { buffer, name, options, uploadable: true };
        return upload;
      },
    },
  });
  assert.equal(generateCalls, 0);
  assert.equal(editPayload.image, upload);
  assert.equal(Object.hasOwn(editPayload, "input_fidelity"), false);
  assert.equal(editPayload.output_format, "jpeg");
  assert.equal(upload.name, `${CANONICAL_BRAND_BADGE_ID}.png`);
  assert.equal(upload.options.type, "image/png");
  assert.equal(checksum(upload.buffer), CANONICAL_BRAND_BADGE_SHA256);
  assert.equal(result.generation_method, "openai_images_edit_reference");
  assert.deepEqual(result.buffer, output);
});

test("OpenAI gateway explicitly requests high fidelity for earlier GPT Image edit models", async () => {
  const contract = await buildBrandLogoContract({
    draftLike: { idempotency_key: "edit-gateway-legacy-model" },
    recommendation: recommendation(),
  });
  let editPayload = null;
  await callOpenAiImage({
    model: "gpt-image-1.5",
    prompt: "Create the approved branded artwork.",
    size: "1024x1536",
    quality: "medium",
    brandLogoContract: contract,
    dependencies: {
      openaiClient: {
        images: {
          edit: async (payload) => {
            editPayload = payload;
            return { id: "image-edit-response-legacy", data: [{ b64_json: Buffer.from("generated-output").toString("base64") }] };
          },
        },
      },
      toOpenAiFile: async () => ({ canonicalLogoUpload: true }),
    },
  });
  assert.equal(editPayload.input_fidelity, "high");
});

test("independent validator receives reference and generated images and requires strict evidence", async () => {
  const contract = await buildBrandLogoContract({
    draftLike: { idempotency_key: "validator" },
    recommendation: recommendation(),
  });
  const generated = await generatedImageBuffer();
  const pass = passingEvidence(contract.serialized);
  let request = null;
  const result = await validateBrandLogoReference({
    generatedBuffer: generated,
    referenceBuffer: contract.reference.buffer,
    contract,
    expectedTextBlocks: [],
    dependencies: {
      openaiClient: {
        responses: {
          create: async (payload) => {
            request = payload;
            return {
              id: pass.response_id,
              status: "completed",
              output_text: JSON.stringify({
                ...pass,
                response_id: undefined,
                usage: undefined,
                post_generation_logo_overlay_applied: undefined,
              }),
              usage: pass.usage,
            };
          },
        },
      },
    },
  });
  const imageInputs = request.input[0].content.filter((part) => part.type === "input_image");
  assert.equal(imageInputs.length, 2);
  assert.match(imageInputs[0].image_url, /^data:image\/png;base64,/);
  assert.match(imageInputs[1].image_url, /^data:image\/jpeg;base64,/);
  assert.ok(request.text.format.schema.required.includes("observedBadgeWidthPx"));
  assert.ok(request.text.format.schema.required.includes("fullyInsideSafeBox"));
  assert.ok(request.text.format.schema.required.includes("normalizedBoundingBox"));
  assert.ok(request.text.format.schema.required.includes("registeredMarkRecognizable"));
  assert.ok(request.text.format.schema.required.includes("protectedContentOverlapPresent"));
  assert.equal(result.reference_asset_id, CANONICAL_BRAND_BADGE_ID);
  assert.equal(result.method, "AI_REFERENCE_BAKED");
  assert.equal(result.input_fidelity, "high");
  assert.equal(result.logo_count, 1);
  assert.equal(result.identity_checks.approved_logo_present, true);
  assert.equal(result.identity_checks.accepted_width_range, true);
  assert.equal(result.validator_response_id, pass.response_id);
  assert.equal(result.outcome, "PASS");
  const generatedChecksum = checksum(generated);
  assert.equal(result.validated_asset_checksum_sha256, generatedChecksum);
  assert.equal(result.validatedAssetChecksumSha256, generatedChecksum);
  assert.equal(brandLogoEvidencePassed(result, contract, generatedChecksum), true);
  assert.equal(brandLogoEvidencePassed(result, contract, "f".repeat(64)), false);

  for (const mutation of [
    { response_id: null, validator_response_id: null },
    { referenceChecksumSha256: "0".repeat(64) },
    { observedBadgeCount: 2 },
    { approvedLogoPresent: false },
    { wordmarkExactMatch: false },
    { registeredMarkRecognizable: false },
    { observedBadgeWidthPx: 241 },
    { fullyInsideSafeBox: false },
    { normalizedBoundingBox: null, normalized_bounding_box: null },
    { normalizedBoundingBox: { x: 0.05, y: 0.05, width: 0.194, height: 0.156 } },
    { protectedContentOverlapPresent: true },
    { unrelatedLogoOrWatermarkPresent: true },
    { post_generation_logo_overlay_applied: true },
  ]) {
    assert.equal(brandLogoEvidencePassed({ ...result, ...mutation }, contract, generatedChecksum), false, JSON.stringify(mutation));
  }

  const mismatchedEcho = await validateBrandLogoReference({
    generatedBuffer: generated,
    referenceBuffer: contract.reference.buffer,
    contract,
    dependencies: {
      validateBrandLogoReference: async () => ({
        ...passingEvidence(contract.serialized, "logo-validation-mismatched-echo"),
        referenceChecksumSha256: "0".repeat(64),
      }),
    },
  });
  assert.equal(mismatchedEcho.reference_checksum_sha256, "0".repeat(64));
  assert.equal(brandLogoEvidencePassed(mismatchedEcho, contract, generatedChecksum), false);
});

test("FULL_AI v3 removes duplicate brand text while retaining historical v2 manifest", () => {
  const value = recommendation("FULL_AI_GRAPHIC");
  const legacy = fullAiGraphicTextBlocksForSequence(value, 1, 1);
  const current = fullAiGraphicTextBlocksForSequence(value, 1, 1, { contractVersion: 3 });
  assert.equal(legacy.some((block) => block.key === "brand_name" && block.text === "Pink Paisa"), true);
  assert.equal(current.some((block) => block.key === "brand_name"), false);
  assert.deepEqual(current.map((block) => block.key), ["headline", "supporting_text"]);
  const prompt = buildProductionImagePrompt({
    recommendation: value,
    request: { ...value.visualBrief.visuals[0], prompt: value.visualBrief.visuals[0].imagePrompt },
    visualMode: "FULL_AI_GRAPHIC",
    fullAiGraphicContractVersion: 3,
  });
  assert.match(prompt, /ordinary visible-text manifest intentionally excludes the Pink Paisa brand name/i);
  assert.match(prompt, new RegExp(CANONICAL_BRAND_BADGE_ID));
  assert.doesNotMatch(prompt, /\"key\":\"brand_name\"/);
});

test("exact-overlay and FULL_AI generation both use the reference-backed gateway and per-asset evidence", async () => {
  for (const visualMode of ["AI_VISUAL_WITH_EXACT_OVERLAY", "FULL_AI_GRAPHIC"]) {
    let imageCalls = 0;
    let logoChecks = 0;
    const result = await generateSocialVisuals({
      draftLike: { idempotency_key: `reference-gateway-${visualMode}` },
      recommendation: recommendation(visualMode),
      visualMode,
      settings: { models: { image_provider: "openai", image_model: "gpt-image-2" } },
      dependencies: {
        generateOpenAiImage: async ({ brandLogoContract }) => {
          imageCalls += 1;
          assert.equal(brandLogoContract.reference.checksum_sha256, CANONICAL_BRAND_BADGE_SHA256);
          return {
            response_id: `image-edit-${visualMode}`,
            buffer: await generatedImageBuffer(imageCalls + 20),
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            generation_method: "openai_images_edit_reference",
          };
        },
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
          response_id: `poster-check-${visualMode}`,
        }),
        validateBrandLogoReference: async ({ contract }) => {
          logoChecks += 1;
          return passingEvidence(contract, `logo-check-${visualMode}`);
        },
        storeCampaignAsset: async ({ fileName, buffer }) => ({
          url: `https://media.pinkpaisa.test/${fileName}`,
          storage_provider: "external",
          storage_key: `test/${fileName}`,
          checksum_sha256: checksum(buffer),
        }),
        deleteCampaignAsset: async () => true,
        sleep: async () => {},
      },
    });
    assert.equal(imageCalls, 1);
    assert.equal(logoChecks, 1);
    assert.equal(result.brand_logo_contract.reference_asset_id, CANONICAL_BRAND_BADGE_ID);
    assert.equal(result.original_visuals[0].brand_logo_evidence.outcome, "PASS");
    assert.equal(
      result.original_visuals[0].brand_logo_evidence.validated_asset_checksum_sha256,
      result.original_visuals[0].checksum_sha256,
    );
    assert.equal(result.original_visuals[0].normalization.pixel_overlay_applied, false);
    if (visualMode === "FULL_AI_GRAPHIC") {
      assert.equal(result.original_visuals[0].full_ai_graphic_contract_version, 3);
      assert.equal(result.original_visuals[0].expected_text_blocks.some((block) => block.key === "brand_name"), false);
    }
  }
});

test("brand-logo validation retries the failing asset exactly three times and persists evidence", async () => {
  const stores = [];
  const prompts = [];
  let validationCalls = 0;
  const result = await generateSocialVisuals({
    draftLike: { idempotency_key: "three-brand-attempts" },
    recommendation: recommendation(),
    visualMode: AI_BRANDED_ARTWORK_MODE,
    settings: {
      models: { image_provider: "openai", image_model: "gpt-image-2", image_quality: "medium" },
      generation: { max_image_retries: 1 },
    },
    dependencies: {
      generateOpenAiImage: async ({ prompt, brandLogoContract }) => {
        prompts.push(prompt);
        assert.equal(brandLogoContract.reference.checksum_sha256, CANONICAL_BRAND_BADGE_SHA256);
        return {
          response_id: `image-edit-${prompts.length}`,
          buffer: await generatedImageBuffer(prompts.length),
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          generation_method: "openai_images_edit_reference",
        };
      },
      validateBrandLogoReference: async ({ contract }) => {
        validationCalls += 1;
        const evidence = passingEvidence(contract, `brand-check-${validationCalls}`);
        return validationCalls < 3
          ? { ...evidence, decision: "REGENERATE", referenceIdentityMatch: false, issues: ["Badge was redrawn"] }
          : evidence;
      },
      storeCampaignAsset: async ({ fileName, buffer }) => {
        const row = { fileName, buffer, checksum_sha256: checksum(buffer) };
        stores.push(row);
        return {
          url: `https://media.pinkpaisa.test/${fileName}`,
          storage_provider: "external",
          storage_key: `test/${fileName}`,
          checksum_sha256: row.checksum_sha256,
        };
      },
      deleteCampaignAsset: async () => true,
      sleep: async () => {},
    },
  });
  assert.equal(prompts.length, 3);
  assert.equal(validationCalls, 3);
  assert.notEqual(prompts[0], prompts[1]);
  assert.notEqual(prompts[1], prompts[2]);
  assert.equal(result.visual_mode, AI_BRANDED_ARTWORK_MODE);
  assert.equal(result.paid_image_call_count, 3);
  assert.equal(result.original_visuals[0].brand_logo_contract.locked_corner, "TOP_RIGHT");
  assert.equal(result.original_visuals[0].brand_logo_reference.asset_type, "BRAND_LOGO");
  assert.equal(result.original_visuals[0].brand_logo_evidence.decision, "PASS");
  assert.equal(result.original_visuals[0].brand_logo_evidence.outcome, "PASS");
  assert.equal(result.original_visuals[0].brand_logo_evidence.method, "AI_REFERENCE_BAKED");
  assert.equal(result.original_visuals[0].brand_logo_evidence.logo_count, 1);
  assert.equal(result.original_visuals[0].brand_logo_evidence.post_generation_logo_overlay_applied, false);
  assert.equal(result.original_visuals[0].failures.length, 2);
  assert.ok(stores.length >= 6);
});

test("three rejected badge validations fail with the dedicated exhausted error", async () => {
  let imageCalls = 0;
  await assert.rejects(
    () => generateSocialVisuals({
      draftLike: { idempotency_key: "badge-exhaustion" },
      recommendation: recommendation(),
      visualMode: AI_BRANDED_ARTWORK_MODE,
      settings: { models: { image_provider: "openai", image_model: "gpt-image-2" } },
      dependencies: {
        generateOpenAiImage: async () => ({
          response_id: `image-edit-fail-${++imageCalls}`,
          buffer: await generatedImageBuffer(imageCalls),
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }),
        validateBrandLogoReference: async ({ contract }) => ({
          ...passingEvidence(contract, `brand-reject-${imageCalls}`),
          decision: "REGENERATE",
          iconGeometryMatch: false,
          issues: ["Icon geometry differs from reference"],
        }),
        storeCampaignAsset: async ({ fileName, buffer }) => ({
          url: `https://media.pinkpaisa.test/${fileName}`,
          storage_provider: "external",
          storage_key: `test/${fileName}`,
          checksum_sha256: checksum(buffer),
        }),
        deleteCampaignAsset: async () => true,
        sleep: async () => {},
      },
    }),
    (error) => error.code === "social_brand_logo_validation_exhausted"
      && error.image_generation.paid_attempt_count === 3
      && error.image_generation.brand_logo_contract.reference_asset_id === CANONICAL_BRAND_BADGE_ID
      && error.image_generation.failures.length === 3
      && error.image_generation.failures.every((failure) => (
        failure.details.validation.reference_asset_id === CANONICAL_BRAND_BADGE_ID
        && failure.details.validation.method === "AI_REFERENCE_BAKED"
        && failure.details.validation.validator_response_id
      )),
  );
  assert.equal(imageCalls, 3);
});

test("supplied FULL_AI v3 is rejected unless it independently matches the canonical badge", async () => {
  const sourceBuffer = await generatedImageBuffer(8);
  const stored = [];
  let logoChecks = 0;
  const stage = await stageSuppliedFullAiGraphic({
    sourceBuffer,
    format: "SINGLE_IMAGE",
    draftIdentity: "supplied-full-ai-v3",
    model: "gpt-image-2",
    prompt: "Create an approved Pink Paisa poster using the supplied canonical badge.",
    providerResponseId: "supplied-provider-response-1",
    sourceProvenance: "generated_from_approved_source",
    expectedTextBlocks: [{ key: "headline", text: "Pause before you pay" }],
    dependencies: {
      validateFullAiGraphicPoster: async () => ({
        decision: "PASS",
        exactTextMatch: true,
        brandIdentityMatch: true,
        mobileLegible: true,
        safeAreaPassed: true,
        unapprovedTextPresent: false,
        unrelatedLogoOrWatermarkPresent: false,
        observedTextBlocks: ["Pause before you pay"],
        issues: [],
        response_id: "poster-validation-1",
      }),
      validateBrandLogoReference: async ({ contract }) => {
        logoChecks += 1;
        return passingEvidence(contract, "supplied-logo-validation-1");
      },
      storeCampaignAsset: async ({ fileName, buffer }) => {
        stored.push(fileName);
        return {
          url: `https://media.pinkpaisa.test/${fileName}`,
          storage_provider: "external",
          storage_key: `test/${fileName}`,
          checksum_sha256: checksum(buffer),
        };
      },
      deleteCampaignAsset: async () => true,
    },
  });
  assert.equal(logoChecks, 1);
  assert.equal(stage.contract_version, 3);
  assert.equal(stage.brand_logo_contract.reference_asset_id, CANONICAL_BRAND_BADGE_ID);
  assert.equal(stage.brand_logo_evidence.outcome, "PASS");
  assert.equal(stage.brand_logo_evidence.method, "EXTERNAL_REFERENCE_VISUAL_MATCH");
  assert.equal(stage.brand_logo_evidence.input_fidelity, "not_applicable");
  assert.equal(stage.brand_logo_evidence.reference_used_for_generation, false);
  assert.equal(stage.brand_logo_evidence.reference_used_for_validation, true);
  assert.equal(stage.brand_logo_evidence.validated_asset_checksum_sha256, stage.normalized.checksum_sha256);
  assert.equal(stage.brand_logo_evidence.post_generation_logo_overlay_applied, false);
  assert.equal(stage.normalization.post_generation_logo_overlay_applied, false);
  assert.equal(stored.length, 3);

  await assert.rejects(
    () => stageSuppliedFullAiGraphic({
      sourceBuffer,
      format: "SINGLE_IMAGE",
      draftIdentity: "supplied-full-ai-invalid-logo",
      model: "gpt-image-2",
      prompt: "Create a supplied poster.",
      providerResponseId: "supplied-provider-response-2",
      expectedTextBlocks: [{ key: "headline", text: "Pause before you pay" }],
      dependencies: {
        validateFullAiGraphicPoster: async () => ({
          decision: "PASS",
          exactTextMatch: true,
          brandIdentityMatch: true,
          mobileLegible: true,
          safeAreaPassed: true,
          unapprovedTextPresent: false,
          unrelatedLogoOrWatermarkPresent: false,
          observedTextBlocks: ["Pause before you pay"],
          issues: [],
          response_id: "poster-validation-2",
        }),
        validateBrandLogoReference: async ({ contract }) => ({
          ...passingEvidence(contract, "supplied-logo-validation-2"),
          decision: "REGENERATE",
          approvedLogoPresent: false,
          issues: ["Approved badge is missing"],
        }),
      },
    }),
    (error) => error.code === "social_brand_logo_validation_invalid" && error.statusCode === 422,
  );

  await assert.rejects(
    () => stageSuppliedFullAiGraphic({
      sourceBuffer,
      format: "SINGLE_IMAGE",
      draftIdentity: "supplied-full-ai-legacy-manifest",
      model: "gpt-image-2",
      prompt: "Create a supplied poster.",
      providerResponseId: "supplied-provider-response-3",
      expectedTextBlocks: [
        { key: "brand_name", text: "Pink Paisa" },
        { key: "headline", text: "Pause before you pay" },
      ],
    }),
    (error) => error.code === "social_full_ai_graphic_text_contract_invalid",
  );
});
