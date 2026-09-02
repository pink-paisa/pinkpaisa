const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const sharp = require("sharp");

const {
  generateAiInstagramCreative,
  _private: {
    buildBrandedBackgroundPrompt,
    buildLegacyProductRecommendation,
  },
} = require("../services/instagramAiCreativeService");
const {
  CANONICAL_BRAND_BADGE_ID,
  CANONICAL_BRAND_BADGE_SHA256,
} = require("../services/social/socialBrandLogoPolicy");

function brief() {
  return {
    public_product_id: "66f000000000000000000001",
    product_id: "66f000000000000000000001",
    title: "Verified Pink Paisa Yoga Mat",
    category: "Fitness",
    subcategory: "Yoga",
    is_affiliate: true,
    reference_image_url: "https://images.example.com/verified-yoga-mat.png",
    campaign_asset: {
      url: "https://images.example.com/verified-yoga-mat.png",
      approved: true,
      rights_status: "licensed",
      provenance: "amazon_import",
    },
    brand_context: {
      tone: ["premium", "editorial", "modern"],
    },
  };
}

function settings() {
  return {
    campaign_ai_provider: "openai",
    campaign_ai_model: "gpt-image-2",
    campaign_ai_image_quality: "medium",
  };
}

function passingEvidence(contract, validatedAssetChecksumSha256 = null) {
  const box = contract.safe_corner.target_box;
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
    issues: [],
    response_id: "brand-validation-response-1",
    ...(validatedAssetChecksumSha256 ? {
      validated_asset_checksum_sha256: validatedAssetChecksumSha256,
      validatedAssetChecksumSha256: validatedAssetChecksumSha256,
    } : {}),
    post_generation_logo_overlay_applied: false,
  };
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

test("legacy campaign prompt requests a product-free branded background", () => {
  const background = buildBrandedBackgroundPrompt({ brief: brief(), settings: settings() });
  assert.match(background.prompt, /empty background/i);
  assert.match(background.prompt, /Do not render, depict, imitate, redraw, retouch or include any product/i);
  assert.match(background.prompt, /canonical Pink Paisa profile badge/i);
  assert.match(background.prompt, /adaptive locked safe corner/i);

  const recommendation = buildLegacyProductRecommendation({
    brief: brief(),
    prompt: background.prompt,
  });
  assert.equal(recommendation.format, "PRODUCT_FEATURE");
  assert.equal(recommendation.visualMode, "AI_VISUAL_WITH_EXACT_OVERLAY");
  assert.equal(recommendation.verifiedProductFacts.imageUrl, brief().reference_image_url);
  assert.equal(Buffer.isBuffer(recommendation.verifiedProductFacts.imageUrl), false);
});

test("legacy campaign generation uses the shared branded gateway and persists strict evidence", async () => {
  const marketingWrites = [];
  let gatewayInput = null;
  const finalBuffer = Buffer.from("validated-authentic-product-composite");

  const result = await generateAiInstagramCreative({
    run: { _id: "66f000000000000000000099", campaign_id: "legacy-brand-policy-1" },
    brief: brief(),
    settings: settings(),
    dependencies: {
      MarketingAsset: {
        async findOneAndUpdate(filter, update, options) {
          marketingWrites.push({ filter, update, options });
          return update.$set;
        },
      },
      async generateSocialVisuals(input) {
        gatewayInput = input;
        const contract = input.draftLike.brand_logo_contract;
        const visualChecksum = sha256(finalBuffer);
        const evidence = passingEvidence(contract, visualChecksum);
        return {
          status: "SUCCEEDED",
          provider: "openai",
          model: "gpt-image-2",
          brand_logo_contract: contract,
          paid_image_call_count: 1,
          image_usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
          validation_usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
          usage: { input_tokens: 19, output_tokens: 11, total_tokens: 30 },
          estimated_cost: 0.09,
          cost_currency: "USD",
          original_visuals: [{
            sequence: 1,
            buffer: finalBuffer,
            file_path: "/tmp/legacy-brand-policy-1.jpg",
            url: "/uploads/campaigns/legacy-brand-policy-1.jpg",
            storage_provider: "local",
            storage_key: "campaigns/legacy-brand-policy-1.jpg",
            checksum_sha256: visualChecksum,
            provider: "openai",
            model: "gpt-image-2",
            prompt: "server-owned product-free branded prompt",
            response_id: "image-edit-response-1",
            reference_image_checksum_sha256: "b".repeat(64),
            reference_image_mime_type: "image/png",
            authentic_product_reference: {
              width: 800,
              height: 800,
              checksum_sha256: "b".repeat(64),
            },
            authentic_product_composition: {
              renderer: "sharp_authentic_product_composite_v1",
              product_pixels_generated_by_ai: false,
              packaging_editing_performed: false,
              placement: { occurrence_count: 1 },
            },
            ai_background: { checksum_sha256: "c".repeat(64) },
            brand_logo_reference: {
              reference_asset_id: CANONICAL_BRAND_BADGE_ID,
              checksum_sha256: CANONICAL_BRAND_BADGE_SHA256,
            },
            brand_logo_contract: contract,
            brand_logo_evidence: evidence,
          }],
        };
      },
    },
  });

  assert.ok(gatewayInput);
  assert.equal(gatewayInput.visualMode, "AI_VISUAL_WITH_EXACT_OVERLAY");
  assert.equal(gatewayInput.settings.models.image_provider, "openai");
  assert.equal(gatewayInput.settings.models.image_model, "gpt-image-2");
  assert.equal(gatewayInput.settings.generation.max_image_retries, 3);
  assert.equal(gatewayInput.draftLike.brand_logo_contract.reference_asset_id, CANONICAL_BRAND_BADGE_ID);
  assert.equal(gatewayInput.draftLike.brand_logo_contract.reference_checksum_sha256, CANONICAL_BRAND_BADGE_SHA256);
  assert.equal(gatewayInput.draftLike.brand_logo_contract.locked_corner, "TOP_RIGHT");
  assert.equal(Object.hasOwn(gatewayInput, "sourceImageBuffer"), false);
  assert.equal(gatewayInput.recommendation.verifiedProductFacts.imageUrl, brief().reference_image_url);

  assert.equal(marketingWrites.length, 1);
  assert.equal(marketingWrites[0].update.$set.source_provenance, "generated_from_approved_source");
  assert.equal(marketingWrites[0].update.$set.url, result.primary_asset_url);
  assert.equal(result.brand_logo_contract.reference_asset_id, CANONICAL_BRAND_BADGE_ID);
  assert.equal(result.brand_logo_evidence.decision, "PASS");
  assert.equal(result.provenance.background_generation_method, "openai_images_edit_reference");
  assert.equal(result.provenance.authentic_product_compositor, "sharp_authentic_product_composite_v1");
  assert.equal(result.provenance.product_pixels_generated_by_ai, false);
  assert.equal(result.provenance.product_packaging_editing_performed, false);
  assert.equal(result.provenance.post_generation_logo_overlay_applied, false);
  assert.equal(result.provider_response_id, "image-edit-response-1");
  assert.equal(result.paid_image_call_count, 1);
  assert.equal(result.creative_json.slides[0].brand_logo_evidence.decision, "PASS");
  assert.equal(result.creative_json.slides[0].post_generation_logo_overlay_applied, false);
});

test("legacy integration sends only the canonical badge to the image edit and composes product pixels locally", async () => {
  const generatedBackground = await sharp({
    create: {
      width: 1088,
      height: 1360,
      channels: 3,
      background: { r: 245, g: 226, b: 233 },
    },
  }).jpeg().toBuffer();
  const authenticProduct = await sharp({
    create: {
      width: 320,
      height: 520,
      channels: 4,
      background: { r: 150, g: 20, b: 80, alpha: 0.9 },
    },
  }).png().toBuffer();
  const authenticChecksum = sha256(authenticProduct);
  const imageCalls = [];
  let storageIndex = 0;

  const result = await generateAiInstagramCreative({
    run: { _id: "66f000000000000000000099", campaign_id: "legacy-brand-policy-integration" },
    brief: brief(),
    settings: settings(),
    dependencies: {
      MarketingAsset: { findOneAndUpdate: async () => ({}) },
      async resolveVerifiedProductRecord(reference) {
        return {
          id: reference.id,
          title: reference.title,
          url: reference.url,
          is_affiliate: true,
          usage_rights_status: "licensed",
          database_model: "Product",
          database_record_verified: true,
          image_provenance: "amazon_import",
        };
      },
      async readAuthenticProductReference(product) {
        return {
          buffer: authenticProduct,
          source_url: product.url,
          checksum_sha256: authenticChecksum,
          mime_type: "image/png",
          detected_file_signature: "png",
          file_size_bytes: authenticProduct.length,
          width: 320,
          height: 520,
          product_id: product.id,
          product_title: product.title,
          database_model: "Product",
          database_record_verified: true,
          source_kind: "focused_test",
          usage_rights_status: "licensed",
          image_provenance: "amazon_import",
        };
      },
      async generateOpenAiImage(input) {
        imageCalls.push(input);
        assert.equal(Object.hasOwn(input, "sourceImageBuffer"), false);
        assert.equal(input.brandLogoContract.reference.checksum_sha256, CANONICAL_BRAND_BADGE_SHA256);
        assert.equal(sha256(input.brandLogoContract.reference.buffer), CANONICAL_BRAND_BADGE_SHA256);
        assert.notEqual(sha256(input.brandLogoContract.reference.buffer), authenticChecksum);
        return {
          buffer: generatedBackground,
          response_id: "real-shared-gateway-edit-1",
          usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 },
          generation_method: "openai_images_edit_reference",
        };
      },
      async validateBrandLogoReference({ contract }) {
        return passingEvidence(contract);
      },
      async storeCampaignAsset({ fileName, buffer }) {
        storageIndex += 1;
        return {
          file_path: `/tmp/${fileName}`,
          url: `/uploads/campaigns/${fileName}`,
          storage_provider: "local",
          storage_key: `campaigns/${storageIndex}-${fileName}`,
          checksum_sha256: sha256(buffer),
        };
      },
    },
  });

  assert.equal(imageCalls.length, 1);
  assert.match(imageCalls[0].prompt, /BACKGROUND ONLY/i);
  assert.match(imageCalls[0].prompt, /OpenAI must never receive or transform its pixels/i);
  assert.equal(result.creative_json.authentic_product_composition.renderer, "sharp_authentic_product_composite_v1");
  assert.equal(result.creative_json.authentic_product_composition.source_reference_checksum_sha256, authenticChecksum);
  assert.equal(result.creative_json.authentic_product_composition.product_pixels_generated_by_ai, false);
  assert.equal(result.brand_logo_evidence.outcome, "PASS");
  assert.equal(result.brand_logo_evidence.post_generation_logo_overlay_applied, false);
});

test("legacy campaign preflight rejects altered canonical bytes before entering the paid gateway", async () => {
  let gatewayCalls = 0;
  await assert.rejects(
    () => generateAiInstagramCreative({
      run: { _id: "66f000000000000000000099", campaign_id: "legacy-brand-policy-bad-logo" },
      brief: brief(),
      settings: settings(),
      dependencies: {
        readFile: async () => Buffer.from("not-the-approved-logo"),
        generateSocialVisuals: async () => { gatewayCalls += 1; },
      },
    }),
    (error) => error.code === "social_brand_logo_reference_invalid",
  );
  assert.equal(gatewayCalls, 0);
});

test("legacy campaign preserves paid failure evidence from exhausted badge validation", async () => {
  const paidFailure = Object.assign(new Error("badge validation exhausted"), {
    code: "social_brand_logo_validation_exhausted",
    usage: { input_tokens: 33, output_tokens: 12, total_tokens: 45 },
    estimated_cost: 0.27,
    image_generation: {
      paid_attempt_count: 3,
      paid_image_call_count: 3,
      failures: [
        { attempt: 1, provider_response_id: "image-edit-1" },
        { attempt: 2, provider_response_id: "image-edit-2" },
        { attempt: 3, provider_response_id: "image-edit-3" },
      ],
    },
  });

  await assert.rejects(
    () => generateAiInstagramCreative({
      run: { _id: "66f000000000000000000099", campaign_id: "legacy-brand-policy-exhausted" },
      brief: brief(),
      settings: settings(),
      dependencies: {
        generateSocialVisuals: async () => { throw paidFailure; },
      },
    }),
    (error) => {
      assert.equal(error.code, "social_brand_logo_validation_exhausted");
      assert.equal(error.image_generation.paid_image_call_count, 3);
      assert.equal(error.image_generation.failures[2].provider_response_id, "image-edit-3");
      assert.equal(error.usage.total_tokens, 45);
      assert.equal(error.estimated_cost, 0.27);
      return true;
    },
  );
});
