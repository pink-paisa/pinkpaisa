const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const {
  CANONICAL_BRAND_BADGE_ID,
  CANONICAL_BRAND_BADGE_SHA256,
} = require("../services/social/socialBrandLogoPolicy");
const {
  buildReadiness,
  publishSocialDraft,
  _private: {
    brandLogoPublicationEvidencePassed,
    verifyMandatoryBrandPublicationAssetIntegrity,
  },
} = require("../services/social/socialPublishingService");

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function requiredLogoContract(corner = "TOP_RIGHT") {
  const targetBox = {
    canvas_width: 1080,
    canvas_height: 1350,
    left: corner.endsWith("RIGHT") ? 806 : 64,
    top: corner.startsWith("BOTTOM") ? 1076 : 64,
    width: 210,
    height: 210,
    minimum_clear_space_px: 24,
  };
  return {
    contract_version: 1,
    policy_version: "pink-paisa-mandatory-ai-baked-v1",
    required: true,
    method: "AI_REFERENCE_BAKED",
    reference_asset_id: CANONICAL_BRAND_BADGE_ID,
    reference_checksum_sha256: CANONICAL_BRAND_BADGE_SHA256,
    reference_mime_type: "image/png",
    reference_width: 512,
    reference_height: 512,
    badge_id: CANONICAL_BRAND_BADGE_ID,
    checksum_sha256: CANONICAL_BRAND_BADGE_SHA256,
    mime_type: "image/png",
    width: 512,
    height: 512,
    has_alpha: true,
    generation_method: "openai_images_edit_reference",
    input_fidelity: "high",
    placement_strategy: "ADAPTIVE_SAFE_CORNER_LOCKED_PER_DRAFT",
    locked_corner: corner,
    target_width_px: 210,
    accepted_width_range_px: [180, 240],
    readiness_status: "VERIFIED",
    occurrence_count: 1,
    safe_corner: {
      corner,
      target_box: targetBox,
      lock_id: "locked-brand-corner-for-test",
      locked_to_draft: true,
    },
    post_generation_logo_overlay_applied: false,
  };
}

function passingLogoEvidence(contract, responseId = "logo-validator-response", {
  validatedChecksum = "d".repeat(64),
  finalChecksum = "e".repeat(64),
  nativePassthrough = false,
} = {}) {
  const box = contract.safe_corner.target_box;
  return {
    reference_asset_id: contract.reference_asset_id,
    reference_checksum_sha256: contract.reference_checksum_sha256,
    method: "AI_REFERENCE_BAKED",
    input_fidelity: "high",
    requested_corner: contract.locked_corner,
    observed_corner: contract.locked_corner,
    normalized_bounding_box: {
      x: box.left / box.canvas_width,
      y: box.top / box.canvas_height,
      width: box.width / box.canvas_width,
      height: box.height / box.canvas_height,
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
    validator_response_id: responseId,
    validated_asset_checksum_sha256: validatedChecksum,
    outcome: "PASS",
    issues: [],
    validated_asset: nativePassthrough ? "final_publishable_asset" : "openai_normalized_final",
    final_asset_preservation: nativePassthrough
      ? {
        method: "checksum_identical_ai_passthrough_v1",
        source_validated_asset_checksum_sha256: validatedChecksum,
        final_publishable_asset_checksum_sha256: finalChecksum,
        pixel_overlay_applied: false,
        post_generation_logo_overlay_applied: false,
      }
      : {
        method: "locked_safe_box_overlay_exclusion_v1",
        final_asset_role: "final_publishable_asset",
        source_validated_asset_checksum_sha256: validatedChecksum,
        final_publishable_asset_checksum_sha256: finalChecksum,
        programmatic_copy_or_brand_pixels_inside_excluded_box: false,
        post_generation_logo_overlay_applied: false,
      },
    post_generation_logo_overlay_applied: false,
  };
}

function recommendation(format = "SINGLE_IMAGE") {
  const scenes = format === "REEL"
    ? [
      { sceneNumber: 1, durationSeconds: 3, onScreenText: "Pause and check" },
      { sceneNumber: 2, durationSeconds: 4, onScreenText: "Decide calmly" },
    ]
    : [];
  return {
    format,
    objective: "EDUCATION",
    contentPillar: "Money Education",
    topic: "One careful money habit",
    caption: "Pause before making an important money decision.",
    cta: "Save this reminder.",
    financialDisclaimer: "Educational content only. This is not personalised investment advice.",
    hashtags: ["#PinkPaisa", "#MoneyEducation"],
    sources: [],
    riskFlags: [],
    utmParameters: {
      source: "instagram",
      medium: "organic_social",
      campaign: "20260902-money-education",
      content: "one-careful-money-habit",
    },
    formatContent: { format, scenes },
  };
}

function draftFor(format = "SINGLE_IMAGE", contract = requiredLogoContract()) {
  return {
    _id: "draft-logo-policy",
    status: "APPROVED",
    revision: 1,
    approved_revision: 1,
    approved_at: new Date("2026-09-02T08:00:00.000Z"),
    approved_by_admin_id: "admin-logo-policy",
    current_package: { primaryRecommendation: recommendation(format) },
    brand_logo_contract: contract,
  };
}

function publishableAsset(overrides = {}) {
  return {
    _id: "asset-logo-policy",
    is_active: true,
    deleted_at: null,
    slide_number: 1,
    url: "https://media.pinkpaisa.in/social/logo-policy.jpg",
    mime_type: "image/jpeg",
    validation_status: "valid",
    manual_review_required: false,
    manual_review_status: "not_required",
    ...overrides,
  };
}

function withPublishingEnabled(callback) {
  const previousPublishing = process.env.SOCIAL_MANAGER_PUBLISHING_ENABLED;
  const previousLegacyPublishing = process.env.SOCIAL_INSTAGRAM_PUBLISHING_ENABLED;
  const previousExpectedAccount = process.env.SOCIAL_MANAGER_INSTAGRAM_ACCOUNT_ID;
  process.env.SOCIAL_MANAGER_PUBLISHING_ENABLED = "true";
  delete process.env.SOCIAL_INSTAGRAM_PUBLISHING_ENABLED;
  delete process.env.SOCIAL_MANAGER_INSTAGRAM_ACCOUNT_ID;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (previousPublishing === undefined) delete process.env.SOCIAL_MANAGER_PUBLISHING_ENABLED;
      else process.env.SOCIAL_MANAGER_PUBLISHING_ENABLED = previousPublishing;
      if (previousLegacyPublishing === undefined) delete process.env.SOCIAL_INSTAGRAM_PUBLISHING_ENABLED;
      else process.env.SOCIAL_INSTAGRAM_PUBLISHING_ENABLED = previousLegacyPublishing;
      if (previousExpectedAccount === undefined) delete process.env.SOCIAL_MANAGER_INSTAGRAM_ACCOUNT_ID;
      else process.env.SOCIAL_MANAGER_INSTAGRAM_ACCOUNT_ID = previousExpectedAccount;
    });
}

test("publishing accepts only strict canonical evidence for new-policy images", () => {
  const contract = requiredLogoContract();
  const draft = draftFor("SINGLE_IMAGE", contract);
  const validAsset = publishableAsset({
    checksum_sha256: "e".repeat(64),
    brand_logo_contract: contract,
    brand_logo_evidence: passingLogoEvidence(contract),
    provenance: {
      base_image: { checksum_sha256: "d".repeat(64) },
      post_generation_logo_overlay_applied: false,
    },
  });

  assert.equal(brandLogoPublicationEvidencePassed({ draft, asset: validAsset, format: "SINGLE_IMAGE" }), true);
  const baseOnlyEvidence = { ...validAsset.brand_logo_evidence };
  delete baseOnlyEvidence.validated_asset;
  delete baseOnlyEvidence.final_asset_preservation;
  assert.equal(brandLogoPublicationEvidencePassed({
    draft,
    asset: { ...validAsset, brand_logo_evidence: baseOnlyEvidence },
    format: "SINGLE_IMAGE",
  }), false);
  assert.equal(brandLogoPublicationEvidencePassed({
    draft,
    asset: { ...validAsset, brand_logo_evidence: null },
    format: "SINGLE_IMAGE",
  }), false);
  assert.equal(brandLogoPublicationEvidencePassed({
    draft,
    asset: {
      ...validAsset,
      brand_logo_evidence: { ...validAsset.brand_logo_evidence, logo_count: 2 },
    },
    format: "SINGLE_IMAGE",
  }), false);
  assert.equal(brandLogoPublicationEvidencePassed({
    draft,
    asset: {
      ...validAsset,
      provenance: { post_generation_logo_overlay_applied: true },
    },
    format: "SINGLE_IMAGE",
  }), false);
});

test("native Full-AI images may prove final-pixel preservation through byte-identical passthrough", () => {
  const contract = requiredLogoContract();
  const draft = draftFor("SINGLE_IMAGE", contract);
  const checksum = "a".repeat(64);
  const nativeEvidence = passingLogoEvidence(contract, "native-poster-logo-response", {
    validatedChecksum: checksum,
    finalChecksum: checksum,
    nativePassthrough: true,
  });
  const nativeAsset = publishableAsset({
    visual_mode: "FULL_AI_GRAPHIC",
    checksum_sha256: checksum,
    brand_logo_contract: contract,
    brand_logo_evidence: nativeEvidence,
    provenance: {
      full_ai_graphic_contract_version: 3,
      overlay: { method: "none", pixel_overlay_applied: false },
      base_image: { checksum_sha256: checksum },
      post_generation_logo_overlay_applied: false,
    },
  });

  assert.equal(brandLogoPublicationEvidencePassed({ draft, asset: nativeAsset, format: "SINGLE_IMAGE" }), true);
  assert.equal(brandLogoPublicationEvidencePassed({
    draft,
    asset: {
      ...nativeAsset,
      checksum_sha256: "b".repeat(64),
    },
    format: "SINGLE_IMAGE",
  }), false);
});

test("readiness blocks invalid new-policy media while historical media remains compatible", () => {
  const contract = requiredLogoContract();
  const draft = draftFor("SINGLE_IMAGE", contract);
  const bareAsset = publishableAsset();
  const common = {
    settings: {
      approval: { require_human_approval: true },
      publishing: { enabled: false, provider: "INSTAGRAM_GRAPH", auto_publish: false },
    },
    connection: { is_connected: false, status: "not_configured", granted_scopes: [] },
    now: new Date("2026-09-02T09:00:00.000Z"),
    publishNow: true,
  };

  const blocked = buildReadiness({ ...common, draft, assets: [bareAsset] });
  assert.ok(blocked.blockers.some((blocker) => blocker.code === "social_brand_logo_evidence_invalid"));

  const valid = buildReadiness({
    ...common,
    draft,
    assets: [{
      ...bareAsset,
      checksum_sha256: "e".repeat(64),
      brand_logo_contract: contract,
      brand_logo_evidence: passingLogoEvidence(contract),
      provenance: {
        base_image: { checksum_sha256: "d".repeat(64) },
        post_generation_logo_overlay_applied: false,
      },
    }],
  });
  assert.equal(valid.blockers.some((blocker) => blocker.code === "social_brand_logo_evidence_invalid"), false);

  const historicalDraft = { ...draft };
  delete historicalDraft.brand_logo_contract;
  const historical = buildReadiness({ ...common, draft: historicalDraft, assets: [bareAsset] });
  assert.equal(historical.blockers.some((blocker) => blocker.code === "social_brand_logo_evidence_invalid"), false);
});

test("publishing requires passing logo evidence for every final MP4 scene", () => {
  const contract = requiredLogoContract();
  const draft = draftFor("REEL", contract);
  const firstChecksum = "1".repeat(64);
  const secondChecksum = "2".repeat(64);
  const first = passingLogoEvidence(contract, "scene-logo-response-1", { validatedChecksum: firstChecksum });
  const second = passingLogoEvidence(contract, "scene-logo-response-2", { validatedChecksum: secondChecksum });
  const video = publishableAsset({
    mime_type: "video/mp4",
    url: "https://media.pinkpaisa.in/social/logo-policy.mp4",
    brand_logo_contract: contract,
    provenance: {
      post_generation_logo_overlay_applied: false,
      brand_logo_scene_evidence: [
        { ...first, scene_index: 0, extracted_frame_checksum_sha256: firstChecksum },
        { ...second, scene_index: 1, extracted_frame_checksum_sha256: secondChecksum },
      ],
    },
  });

  assert.equal(brandLogoPublicationEvidencePassed({ draft, asset: video, format: "REEL" }), true);
  assert.equal(brandLogoPublicationEvidencePassed({
    draft,
    asset: {
      ...video,
      provenance: {
        ...video.provenance,
        brand_logo_scene_evidence: [{ ...first, scene_index: 0, extracted_frame_checksum_sha256: firstChecksum }],
      },
    },
    format: "REEL",
  }), false);
  assert.equal(brandLogoPublicationEvidencePassed({
    draft,
    asset: {
      ...video,
      provenance: {
        ...video.provenance,
        brand_logo_scene_evidence: [
          { ...first, scene_index: 0, extracted_frame_checksum_sha256: firstChecksum },
          { ...second, outcome: "FAIL", scene_index: 1, extracted_frame_checksum_sha256: secondChecksum },
        ],
      },
    },
    format: "REEL",
  }), false);
});

test("pre-publish integrity hashes every ordered multi-frame Story asset, including video frames", async () => {
  const contract = requiredLogoContract();
  const draft = draftFor("STORY", contract);
  const bytesByPath = new Map();
  const assets = ["image/jpeg", "video/mp4", "image/png"].map((mimeType, index) => {
    const sequence = index + 1;
    const bytes = Buffer.from(`final-story-asset-${sequence}`);
    const filePath = `virtual-story-${sequence}`;
    bytesByPath.set(filePath, bytes);
    return publishableAsset({
      _id: `story-asset-${sequence}`,
      slide_number: sequence,
      mime_type: mimeType,
      storage_provider: "local",
      storage_key: `uploads/generated/campaigns/story-${sequence}.${mimeType === "video/mp4" ? "mp4" : "png"}`,
      checksum_sha256: sha256Buffer(bytes),
    });
  });
  const resolvedKeys = [];
  const hashedPaths = [];

  const result = await verifyMandatoryBrandPublicationAssetIntegrity({
    draft,
    assets,
    dependencies: {
      getGeneratedCampaignAssetReference: (storageKey) => {
        resolvedKeys.push(storageKey);
        const sequence = resolvedKeys.length;
        return { filePath: `virtual-story-${sequence}`, storageKey };
      },
      hashFileSha256: async (filePath) => {
        hashedPaths.push(filePath);
        return sha256Buffer(bytesByPath.get(filePath));
      },
    },
  });

  assert.equal(result.status, "PASSED");
  assert.equal(result.verified_asset_count, 3);
  assert.deepEqual(result.verified_assets.map((asset) => asset.asset_sequence), [1, 2, 3]);
  assert.deepEqual(resolvedKeys, assets.map((asset) => asset.storage_key));
  assert.deepEqual(hashedPaths, ["virtual-story-1", "virtual-story-2", "virtual-story-3"]);
});

test("pre-publish integrity verifies the final MP4 bytes and fails closed for unsupported or changed assets", async () => {
  const contract = requiredLogoContract();
  const draft = draftFor("REEL", contract);
  const finalVideoBytes = Buffer.from("final-assembled-branded-reel");
  const video = publishableAsset({
    _id: "final-reel-video",
    slide_number: 1,
    mime_type: "video/mp4",
    storage_provider: "local",
    storage_key: "uploads/generated/campaigns/final-reel.mp4",
    checksum_sha256: sha256Buffer(finalVideoBytes),
  });
  const dependencies = {
    getGeneratedCampaignAssetReference: () => ({
      filePath: "virtual-final-reel.mp4",
      storageKey: video.storage_key,
    }),
    hashFileSha256: async () => sha256Buffer(finalVideoBytes),
  };

  const valid = await verifyMandatoryBrandPublicationAssetIntegrity({ draft, assets: [video], dependencies });
  assert.equal(valid.verified_assets[0].checksum_sha256, video.checksum_sha256);

  await assert.rejects(
    () => verifyMandatoryBrandPublicationAssetIntegrity({
      draft,
      assets: [video],
      dependencies: { ...dependencies, hashFileSha256: async () => "f".repeat(64) },
    }),
    (error) => error.code === "social_brand_logo_asset_integrity_invalid"
      && error.is_retriable === false
      && error.details.reason === "checksum_mismatch",
  );
  await assert.rejects(
    () => verifyMandatoryBrandPublicationAssetIntegrity({
      draft,
      assets: [{ ...video, storage_provider: "external" }],
      dependencies,
    }),
    (error) => error.code === "social_brand_logo_asset_integrity_invalid"
      && error.is_retriable === false
      && error.details.reason === "storage_provider_unsupported",
  );
  await assert.rejects(
    () => verifyMandatoryBrandPublicationAssetIntegrity({
      draft,
      assets: [video],
      dependencies: { ...dependencies, hashFileSha256: async () => { throw new Error("missing"); } },
    }),
    (error) => error.code === "social_brand_logo_asset_integrity_invalid"
      && error.is_retriable === false
      && error.details.reason === "asset_missing_or_unreadable",
  );
});

test("a changed final branded asset fails non-retriably before the Instagram provider is called", async () => {
  await withPublishingEnabled(async () => {
    const contract = requiredLogoContract();
    const expectedBytes = Buffer.from("approved-final-branded-image");
    const finalChecksum = sha256Buffer(expectedBytes);
    const draft = {
      ...draftFor("SINGLE_IMAGE", contract),
      asset_ids: ["integrity-asset-1"],
      async save() { return this; },
    };
    const asset = publishableAsset({
      _id: "integrity-asset-1",
      url: "https://pinkpaisa.in/uploads/generated/campaigns/integrity-final.jpg",
      storage_provider: "local",
      storage_key: "uploads/generated/campaigns/integrity-final.jpg",
      checksum_sha256: finalChecksum,
      brand_logo_contract: contract,
      brand_logo_evidence: passingLogoEvidence(contract, "integrity-logo-validation", {
        finalChecksum,
      }),
      provenance: {
        base_image: { checksum_sha256: "d".repeat(64) },
        post_generation_logo_overlay_applied: false,
      },
    });
    let publication = null;
    let providerCalls = 0;
    let hashCalls = 0;
    const audits = [];
    const dependencies = {
      SocialPostDraft: { findById: async () => draft },
      SocialAsset: { find: () => ({ sort: async () => [asset] }) },
      SocialPublication: {
        findOne: async () => publication,
        create: async (input) => {
          publication = {
            _id: "integrity-publication-1",
            ...input,
            attempt_count: 0,
            retry_count: 0,
            async save() { return this; },
          };
          return publication;
        },
        findOneAndUpdate: async () => {
          publication.status = "VALIDATING";
          publication.attempt_count += 1;
          return publication;
        },
      },
      SocialAuditLog: { create: async (entry) => { audits.push(entry); return entry; } },
      getInstagramConnectionSummary: async () => ({
        id: "instagram-connection-1",
        is_connected: true,
        status: "connected",
        instagram_username: "pinkpaisaofficial",
        account_type: "BUSINESS",
        granted_scopes: ["instagram_business_content_publish"],
        token_expires_at: "2026-10-01T00:00:00.000Z",
      }),
      assertWeeklyPublicationCapacity: async () => ({ ok: true }),
      syncWeeklyPlanFromDraft: async () => {},
      getGeneratedCampaignAssetReference: () => ({
        filePath: "virtual-integrity-final.jpg",
        storageKey: asset.storage_key,
      }),
      hashFileSha256: async () => {
        hashCalls += 1;
        return sha256Buffer(Buffer.from("changed-after-approval"));
      },
      publishInstagramDraft: async () => {
        providerCalls += 1;
        throw new Error("provider must not be called");
      },
    };

    await assert.rejects(
      () => publishSocialDraft({
        draftId: draft._id,
        settings: {
          approval: { require_human_approval: true },
          publishing: { enabled: true, provider: "INSTAGRAM_GRAPH", auto_publish: false },
        },
        now: new Date("2026-09-02T09:00:00.000Z"),
        dependencies,
      }),
      (error) => error.code === "social_brand_logo_asset_integrity_invalid"
        && error.is_retriable === false
        && error.details.reason === "checksum_mismatch",
    );

    assert.equal(hashCalls, 1);
    assert.equal(providerCalls, 0);
    assert.equal(publication.status, "FAILED");
    assert.equal(publication.next_retry_at, null);
    assert.equal(publication.last_error.code, "social_brand_logo_asset_integrity_invalid");
    assert.equal(publication.last_error.is_retriable, false);
    assert.equal(draft.status, "FAILED");
    assert.equal(draft.last_error.is_retriable, false);
    assert.ok(audits.some((entry) => entry.action === "PUBLISH_FAILED"));
  });
});
