const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const sharp = require("sharp");

const { callOpenAiImage } = require("../services/social/socialAiImageService");
const {
  CANONICAL_BRAND_BADGE_SHA256,
  buildBrandLogoContract,
} = require("../services/social/socialBrandLogoPolicy");
const {
  compositeAuthenticProduct,
  downloadAllowlistedProductImage,
  resolveVerifiedProductRecord,
  validateAuthenticReferenceBuffer,
} = require("../services/social/socialProductCreativeService");

function checksum(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function pngBuffer({ width = 240, height = 320, alpha = 1 } = {}) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 111, g: 26, b: 79, alpha },
    },
  }).png().toBuffer();
}

test("OpenAI product-image path edits only with the canonical logo and never uploads authentic product bytes", async () => {
  let generated = 0;
  let edited = 0;
  const payloads = [];
  const productReference = await pngBuffer();
  const brandLogoContract = await buildBrandLogoContract({
    draftLike: { idempotency_key: "product-logo-reference-test" },
    recommendation: { format: "PRODUCT_FEATURE", topic: "Authentic product" },
  });
  let uploadedBytes = null;
  const result = await callOpenAiImage({
    model: "gpt-image-2",
    prompt: "Generate only a text-free product-free background.",
    size: "1088x1360",
    quality: "medium",
    brandLogoContract,
    dependencies: {
      openaiClient: {
        images: {
          generate: async (payload) => {
            generated += 1;
            payloads.push(payload);
            return { id: "background-response", data: [{ b64_json: Buffer.from("background-bytes").toString("base64") }] };
          },
          edit: async (payload) => {
            edited += 1;
            payloads.push(payload);
            return { id: "background-response", data: [{ b64_json: Buffer.from("background-bytes").toString("base64") }] };
          },
        },
      },
      toOpenAiFile: async (buffer) => {
        uploadedBytes = buffer;
        return { canonicalLogoUpload: true };
      },
    },
  });

  assert.equal(generated, 0);
  assert.equal(edited, 1);
  assert.equal(Object.hasOwn(payloads[0], "input_fidelity"), false);
  assert.equal(checksum(uploadedBytes), CANONICAL_BRAND_BADGE_SHA256);
  assert.equal(uploadedBytes.equals(productReference), false);
  assert.equal(result.buffer.toString(), "background-bytes");
});

test("verified product record must still match the active production database record exactly", async () => {
  const reference = {
    id: "507f1f77bcf86cd799439011",
    title: "Calm Wellness Journal",
    url: "https://media.pinkpaisa.in/products/calm.png",
  };
  const product = {
    _id: reference.id,
    title: reference.title,
    status: "active",
    is_visible: true,
    archived_at: null,
    is_affiliate: true,
    affiliate_is_instagram_pick: true,
    affiliate_link_check_status: "ok",
    affiliate_compliance_status: "compliant",
    affiliate_campaign_usage_rights: "admin_confirmed",
    affiliate_campaign_asset_url: reference.url,
    affiliate_image_provenance: "admin_provided",
  };
  const resolved = await resolveVerifiedProductRecord(reference, {
    getVerifiedProductRecord: async () => product,
  });
  assert.equal(resolved.database_record_verified, true);
  assert.equal(resolved.url, reference.url);

  await assert.rejects(
    resolveVerifiedProductRecord(reference, {
      getVerifiedProductRecord: async () => ({ ...product, affiliate_campaign_asset_url: "https://media.pinkpaisa.in/products/replacement.png" }),
    }),
    (error) => error.code === "social_product_reference_mismatch",
  );
  await assert.rejects(
    resolveVerifiedProductRecord(reference, {
      getVerifiedProductRecord: async () => ({ ...product, affiliate_campaign_usage_rights: "unknown" }),
    }),
    (error) => error.code === "social_product_reference_rights_invalid",
  );
  for (const unsafeProduct of [
    { ...product, affiliate_is_instagram_pick: false },
    { ...product, affiliate_link_check_status: "unchecked" },
    { ...product, affiliate_link_check_status: null },
  ]) {
    await assert.rejects(
      resolveVerifiedProductRecord(reference, { getVerifiedProductRecord: async () => unsafeProduct }),
      (error) => error.code === "social_product_reference_rights_invalid"
        && /approved Instagram pick with link health exactly ok/i.test(error.message),
    );
  }
});

test("product downloads reject unallowlisted and private-address hosts before any request", async () => {
  let requests = 0;
  const dependencies = {
    allowedProductImageHosts: ["media.pinkpaisa.in"],
    lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    httpGet: async () => {
      requests += 1;
      throw new Error("must not request blocked URLs");
    },
  };
  await assert.rejects(
    downloadAllowlistedProductImage("https://evil.example/product.png", dependencies),
    (error) => error.code === "social_product_reference_url_blocked",
  );
  await assert.rejects(
    downloadAllowlistedProductImage("https://media.pinkpaisa.in/product.png", dependencies),
    (error) => error.code === "social_product_reference_url_blocked" && /private|reserved/i.test(error.message),
  );
  assert.equal(requests, 0);
});

test("authentic reference validation enforces file signature, MIME, size and checksum integrity", async () => {
  const reference = await pngBuffer();
  const digest = checksum(reference);
  const validated = await validateAuthenticReferenceBuffer(reference, {
    sourceUrl: "https://media.pinkpaisa.in/products/calm.png",
    declaredMimeType: "image/png",
    suppliedChecksum: digest,
  });
  assert.equal(validated.detected_file_signature, "png");
  assert.equal(validated.checksum_sha256, digest);
  assert.equal(validated.buffer, reference);

  await assert.rejects(
    validateAuthenticReferenceBuffer(reference, {
      sourceUrl: "https://media.pinkpaisa.in/products/calm.png",
      declaredMimeType: "image/jpeg",
    }),
    (error) => error.code === "social_product_reference_invalid" && /MIME type/i.test(error.message),
  );
  await assert.rejects(
    validateAuthenticReferenceBuffer(reference, {
      sourceUrl: "https://media.pinkpaisa.in/products/calm.png",
      suppliedChecksum: "0".repeat(64),
    }),
    (error) => error.code === "social_product_reference_mismatch",
  );
  await assert.rejects(
    validateAuthenticReferenceBuffer(Buffer.from("not-an-image"), {
      sourceUrl: "https://media.pinkpaisa.in/products/calm.png",
    }),
    (error) => error.code === "social_product_reference_invalid" && /signature/i.test(error.message),
  );
});

test("guarded local composition leaves source bytes intact and places the verified product exactly once", async () => {
  const referenceBuffer = await pngBuffer({ width: 300, height: 420, alpha: 0.9 });
  const sourceCopy = Buffer.from(referenceBuffer);
  const backgroundBuffer = await sharp({
    create: {
      width: 1080,
      height: 1350,
      channels: 3,
      background: { r: 248, g: 235, b: 229 },
    },
  }).jpeg().toBuffer();
  const result = await compositeAuthenticProduct({
    backgroundBuffer,
    reference: {
      buffer: referenceBuffer,
      checksum_sha256: checksum(referenceBuffer),
    },
    format: "PRODUCT_FEATURE",
  });

  assert.equal(referenceBuffer.equals(sourceCopy), true);
  assert.equal(checksum(referenceBuffer), result.source_reference_checksum_sha256);
  assert.equal(result.product_pixels_generated_by_ai, false);
  assert.equal(result.packaging_editing_performed, false);
  assert.equal(result.placement.occurrence_count, 1);
  assert.deepEqual(
    await sharp(result.buffer).metadata().then(({ width, height, format }) => ({ width, height, format })),
    { width: 1080, height: 1350, format: "jpeg" },
  );
});

test("VIDEO_FEED uses the full 1080x1920 vertical canvas for authentic product placement", async () => {
  const referenceBuffer = await pngBuffer({ width: 180, height: 260, alpha: 0.9 });
  const sourceCopy = Buffer.from(referenceBuffer);
  const backgroundBuffer = await sharp({
    create: {
      width: 1080,
      height: 1920,
      channels: 3,
      background: { r: 248, g: 235, b: 229 },
    },
  }).jpeg().toBuffer();
  const result = await compositeAuthenticProduct({
    backgroundBuffer,
    reference: {
      buffer: referenceBuffer,
      checksum_sha256: checksum(referenceBuffer),
    },
    format: "VIDEO_FEED",
  });

  assert.equal(referenceBuffer.equals(sourceCopy), true);
  assert.equal(checksum(referenceBuffer), result.source_reference_checksum_sha256);
  assert.equal(result.product_pixels_generated_by_ai, false);
  assert.equal(result.packaging_editing_performed, false);
  assert.equal(result.placement.occurrence_count, 1);
  assert.ok(result.placement.top > 0);
  assert.ok(result.placement.height <= Math.floor(1920 * 0.58));
  assert.deepEqual(
    await sharp(result.buffer).metadata().then(({ width, height, format }) => ({ width, height, format })),
    { width: 1080, height: 1920, format: "jpeg" },
  );
});
