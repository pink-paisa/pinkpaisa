import { describe, expect, it } from "vitest";
import {
  normalizeDraft,
  normalizeGenerationRun,
  normalizeSettingsResponse,
  normalizeWeeklyPlanResponse,
  regenerationPayload,
  settingsPayload,
} from "./adapters";

const checksum = "0cf39611014a2e674bec396a43335f023c803aaffb61256c004bfcb6fabc92e9";
const validatedAssetChecksum = "a".repeat(64);
const finalAssetChecksum = "b".repeat(64);
const contract = {
  contract_version: 1,
  policy_version: "pink-paisa-mandatory-ai-baked-v1",
  required: true,
  method: "AI_REFERENCE_BAKED",
  reference_asset_id: "pink-paisa-profile-badge-v1",
  reference_checksum_sha256: checksum,
  reference_mime_type: "image/png",
  reference_width: 512,
  reference_height: 512,
  reference_url: "/uploads/social/pink-paisa-profile-badge-v1.png",
  input_fidelity: "high",
  placement_strategy: "ADAPTIVE_SAFE_CORNER_LOCKED_PER_DRAFT",
  locked_corner: "TOP_RIGHT",
  target_width_px: 210,
  accepted_width_range_px: [180, 240],
  readiness_status: "READY",
};

const evidence = {
  reference_asset_id: contract.reference_asset_id,
  reference_checksum_sha256: checksum,
  method: "AI_REFERENCE_BAKED",
  input_fidelity: "high",
  generation_method: "openai_images_edit_reference",
  source_provenance: "generated_from_approved_source",
  reference_used_for_generation: true,
  reference_used_for_validation: true,
  validated_asset_checksum_sha256: validatedAssetChecksum,
  validated_asset: "openai_normalized_final",
  requested_corner: "TOP_RIGHT",
  observed_corner: "TOP_RIGHT",
  normalized_bounding_box: { x: 0.72, y: 0.03, width: 0.2, height: 0.2 },
  logo_count: 1,
  identity_checks: {
    wording: true,
    colors: true,
    silhouette: true,
    registered_mark_recognizable: true,
    protected_content_overlap_present: false,
  },
  registered_mark_recognizable: true,
  protected_content_overlap_present: false,
  validator_model: "gpt-5.6-luna",
  validator_response_id: "response-logo-1",
  outcome: "PASS",
  post_generation_logo_overlay_applied: false,
  final_asset_preservation: {
    method: "locked_safe_box_overlay_exclusion_v1",
    final_asset_role: "final_publishable_asset",
    source_validation_response_id: "response-logo-1",
    source_validated_asset_checksum_sha256: validatedAssetChecksum,
    final_publishable_asset_checksum_sha256: finalAssetChecksum,
    programmatic_copy_or_brand_pixels_inside_excluded_box: false,
    post_generation_logo_overlay_applied: false,
  },
};

describe("approved brand-logo adapters", () => {
  it("normalizes canonical contracts on drafts, generation runs, and weekly plans", () => {
    const draft = normalizeDraft({
      _id: "draft-logo-1",
      status: "NEEDS_REVIEW",
      visual_mode: "AI_BRANDED_ARTWORK",
      brand_logo_contract: contract,
      current_package: { primary_recommendation: { topic: "Money safety", internal_title: "Pause first" } },
      assets: [{
        _id: "asset-logo-1",
        role: "FINAL_COMPOSED",
        url: "/uploads/social/logo-1.png",
        checksum_sha256: finalAssetChecksum,
        frame_number: 2,
        provenance: { base_image: { checksum_sha256: validatedAssetChecksum }, brand_logo: evidence },
      }],
    });
    const run = normalizeGenerationRun({ _id: "run-logo-1", brand_logo_contract: contract });
    const plan = normalizeWeeklyPlanResponse({ _id: "plan-logo-1", brand_logo_contract: contract });

    expect(draft?.visualMode).toBe("AI_BRANDED_ARTWORK");
    expect(draft?.brandLogoContract).toMatchObject({
      referenceAssetId: contract.reference_asset_id,
      referenceChecksumSha256: checksum,
      lockedCorner: "TOP_RIGHT",
      acceptedWidthRangePx: [180, 240],
    });
    expect(draft?.assets[0]).toMatchObject({
      slideNumber: 2,
      brandLogoEvidence: {
        referenceAssetId: contract.reference_asset_id,
        logoCount: 1,
        outcome: "PASS",
        postGenerationLogoOverlayApplied: false,
        validatedAssetChecksumSha256: validatedAssetChecksum,
        registeredMarkRecognizable: true,
        protectedContentOverlapPresent: false,
        allScenesPassed: null,
        validatedSceneCount: null,
        expectedSceneCount: null,
        sceneEvidence: [],
      },
    });
    expect(run?.brandLogoContract?.policyVersion).toBe(contract.policy_version);
    expect(plan?.brandLogoContract?.referenceUrl).toBe(contract.reference_url);
  });

  it("accepts defensive camelCase evidence aliases", () => {
    const draft = normalizeDraft({
      id: "draft-logo-camel",
      brandLogoContract: { ...contract, locked_corner: undefined, lockedCorner: "BOTTOM_LEFT" },
      currentPackage: { primaryRecommendation: { topic: "Savings", internalTitle: "Save calmly" } },
      assets: [{
        id: "asset-logo-camel",
        role: "FINAL_COMPOSED",
        url: "/camel.png",
        checksumSha256: finalAssetChecksum,
        provenance: { baseImage: { checksumSha256: validatedAssetChecksum } },
        brandLogoEvidence: {
          ...evidence,
          reference_asset_id: undefined,
          referenceAssetId: contract.reference_asset_id,
          post_generation_logo_overlay_applied: undefined,
          postGenerationLogoOverlayApplied: false,
        },
      }],
    });

    expect(draft?.brandLogoContract?.lockedCorner).toBe("BOTTOM_LEFT");
    expect(draft?.assets[0].brandLogoEvidence?.referenceAssetId).toBe(contract.reference_asset_id);
    expect(draft?.assets[0].brandLogoEvidence?.postGenerationLogoOverlayApplied).toBe(false);
  });

  it("normalizes flat and wrapped final-video scene evidence from provenance", () => {
    const draft = normalizeDraft({
      _id: "draft-logo-scenes",
      status: "NEEDS_REVIEW",
      visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY",
      brand_logo_contract: contract,
      current_package: {
        primary_recommendation: { topic: "Money safety", internal_title: "Pause first", format: "REEL" },
      },
      assets: [{
        _id: "asset-final-video",
        role: "FINAL_VIDEO",
        media_kind: "VIDEO",
        mime_type: "video/mp4",
        url: "/uploads/social/final-reel.mp4",
        checksum_sha256: finalAssetChecksum,
        brand_logo_evidence: {
          ...evidence,
          all_scenes_passed: true,
          validated_scene_count: 2,
          expected_scene_count: 2,
        },
        provenance: {
          storyboard_frames: [
            { scene_index: 0, sequence: 2 },
            { scene_index: 1, sequence: 3 },
          ],
          brand_logo_scene_evidence: [
            {
              ...evidence,
              scene_index: 0,
              extracted_at_seconds: 1.5,
              extracted_frame_checksum_sha256: "a".repeat(64),
            },
            {
              scene_index: 1,
              timestamp_seconds: 5,
              checksum_sha256: "b".repeat(64),
              evidence: { ...evidence, validator_response_id: "response-logo-scene-2" },
            },
          ],
        },
      }],
    });

    expect(draft?.assets[0].brandLogoEvidence).toMatchObject({
      allScenesPassed: true,
      validatedSceneCount: 2,
      expectedSceneCount: 2,
      sceneEvidence: [
        {
          sceneIndex: 0,
          sourceAssetSequence: 2,
          extractedAtSeconds: 1.5,
          extractedFrameChecksumSha256: "a".repeat(64),
          outcome: "PASS",
        },
        {
          sceneIndex: 1,
          sourceAssetSequence: 3,
          extractedAtSeconds: 5,
          extractedFrameChecksumSha256: "b".repeat(64),
          validatorResponseId: "response-logo-scene-2",
          outcome: "PASS",
        },
      ],
    });
  });

  it("keeps artwork-only readable but maps it away from new settings and regeneration requests", () => {
    const historical = normalizeDraft({
      _id: "legacy-artwork-only",
      visual_mode: "AI_ARTWORK_ONLY",
      current_package: { primary_recommendation: { topic: "Legacy", internal_title: "Legacy" } },
    });
    const { settings } = normalizeSettingsResponse({ settings: {
      brand_logo_contract: { ...contract, locked_corner: null },
      generation: { default_visual_mode: "AI_ARTWORK_ONLY" },
    } });

    expect(historical?.visualMode).toBe("AI_ARTWORK_ONLY");
    expect(settings.defaultVisualMode).toBe("AI_BRANDED_ARTWORK");
    expect(regenerationPayload({ scope: "image", visual_mode: "AI_ARTWORK_ONLY" })).toEqual({
      scope: "image",
      visual_mode: "AI_BRANDED_ARTWORK",
    });

    const modeMissing = normalizeDraft({
      _id: "legacy-mode-missing",
      current_package: { primary_recommendation: { topic: "Legacy", internal_title: "Legacy" } },
    });
    expect(modeMissing?.visualMode).toBe("AI_VISUAL_WITH_EXACT_OVERLAY");
  });

  it("emits the canonical snake_case settings contract", () => {
    const unlockedContract = { ...contract, locked_corner: null };
    const { settings } = normalizeSettingsResponse({ settings: {
      visual_brand: {
        use_logo: true,
        logo_policy: unlockedContract,
      },
    } });
    const payload = settingsPayload(settings);

    expect(settings.brandLogoContract.referenceAssetId).toBe(contract.reference_asset_id);
    expect(payload).not.toHaveProperty("brand_logo_contract");
    expect(payload.visual_brand).toEqual(expect.objectContaining({
      use_logo: true,
      logo_policy: expect.objectContaining({
        reference_asset_id: contract.reference_asset_id,
        readiness_status: "VERIFY_BEFORE_GENERATION",
      }),
    }));
    expect(payload.visual_brand.logo_policy).not.toHaveProperty("reference_url");
  });
});
