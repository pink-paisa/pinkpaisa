import { describe, expect, it } from "vitest";
import {
  aggregateBrandLogoEvidence,
  assetBrandLogoState,
  brandLogoEvidencePassed,
  finalVideoBrandLogoEvidencePassed,
  VALIDATED_REFERENCE_MATCH_LOGO_LABEL,
} from "./socialBrandLogo";
import {
  SocialAsset,
  SocialBrandLogoContract,
  SocialBrandLogoEvidence,
  SocialBrandLogoSceneEvidence,
} from "./types";

const checksum = "0cf39611014a2e674bec396a43335f023c803aaffb61256c004bfcb6fabc92e9";
const contract: SocialBrandLogoContract = {
  contractVersion: 1,
  policyVersion: "pink-paisa-mandatory-ai-baked-v1",
  required: true,
  method: "AI_REFERENCE_BAKED",
  referenceAssetId: "pink-paisa-profile-badge-v1",
  referenceChecksumSha256: checksum,
  referenceMimeType: "image/png",
  referenceWidth: 512,
  referenceHeight: 512,
  referenceUrl: "/pink-paisa-logo.png",
  inputFidelity: "high",
  placementStrategy: "ADAPTIVE_SAFE_CORNER_LOCKED_PER_DRAFT",
  lockedCorner: "TOP_RIGHT",
  targetWidthPx: 210,
  acceptedWidthRangePx: [180, 240],
  readinessStatus: "READY",
};

const sceneEvidence = (sceneIndex: number, outcome = "PASS"): SocialBrandLogoSceneEvidence => ({
  referenceAssetId: contract.referenceAssetId,
  referenceChecksumSha256: checksum,
  method: "AI_REFERENCE_BAKED",
  inputFidelity: "high",
  generationMethod: "openai_images_edit_reference",
  referenceValidationMethod: "",
  sourceProvenance: "generated_from_approved_source",
  referenceUsedForGeneration: true,
  referenceUsedForValidation: true,
  validatedAssetChecksumSha256: String(sceneIndex + 1).repeat(64),
  validatedAsset: "openai_normalized_final",
  requestedCorner: "TOP_RIGHT",
  observedCorner: "TOP_RIGHT",
  normalizedBoundingBox: { x: 0.72, y: 0.13, width: 0.2, height: 0.11 },
  logoCount: 1,
  identityChecks: { wording: true, profile: true, colors: true },
  validatorModel: "gpt-5.6-luna",
  validatorResponseId: `logo-scene-${sceneIndex}`,
  outcome,
  postGenerationLogoOverlayApplied: false,
  finalAssetPreservation: null,
  sceneIndex,
  sourceAssetSequence: sceneIndex + 2,
  extractedAtSeconds: sceneIndex === 0 ? 1.5 : 5,
  extractedFrameChecksumSha256: String(sceneIndex + 1).repeat(64),
});

const videoEvidence = (scenes: SocialBrandLogoSceneEvidence[], expectedSceneCount = 2): SocialBrandLogoEvidence => ({
  ...sceneEvidence(0),
  allScenesPassed: scenes.length === expectedSceneCount && scenes.every((scene) => scene.outcome === "PASS"),
  validatedSceneCount: scenes.length,
  expectedSceneCount,
  sceneEvidence: scenes,
});

const finalVideo = (brandLogoEvidence: SocialBrandLogoEvidence): SocialAsset => ({
  role: "FINAL_VIDEO",
  type: "reel_video",
  mediaKind: "VIDEO",
  mimeType: "video/mp4",
  visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
  url: "/uploads/social/reel.mp4",
  finalUrl: "/uploads/social/reel.mp4",
  previewUrl: "/uploads/social/reel.mp4",
  brandLogoEvidence,
} as unknown as SocialAsset);

describe("final-video brand-logo aggregation", () => {
  it("accepts a server-validated supplied Full-AI graphic without falsely claiming high-fidelity generation", () => {
    const evidence = {
      ...sceneEvidence(0),
      method: "EXTERNAL_REFERENCE_VISUAL_MATCH",
      inputFidelity: "not_applicable",
      generationMethod: "externally_supplied_ai_image",
      referenceValidationMethod: "external_reference_visual_match",
      sourceProvenance: "generated_without_reference",
      referenceUsedForGeneration: false,
      referenceUsedForValidation: true,
    };

    expect(brandLogoEvidencePassed(evidence, contract, evidence.extractedFrameChecksumSha256)).toBe(true);
    expect(brandLogoEvidencePassed({ ...evidence, inputFidelity: "high" }, contract, evidence.extractedFrameChecksumSha256)).toBe(false);
  });

  it("labels externally supplied artwork as an approved-reference visual match", () => {
    const evidence = {
      ...sceneEvidence(0),
      method: "EXTERNAL_REFERENCE_VISUAL_MATCH",
      inputFidelity: "not_applicable",
      generationMethod: "externally_supplied_ai_image",
      referenceValidationMethod: "external_reference_visual_match",
      sourceProvenance: "generated_without_reference",
      referenceUsedForGeneration: false,
      referenceUsedForValidation: true,
    };
    const asset = finalVideo(videoEvidence([{ ...evidence, sceneIndex: 0 }], 1));
    asset.brandLogoEvidence = { ...videoEvidence([{ ...evidence, sceneIndex: 0 }], 1), ...evidence };

    expect(assetBrandLogoState(asset, contract).labels).toContain(VALIDATED_REFERENCE_MATCH_LOGO_LABEL);
  });

  it("passes only when every expected scene has unique passing evidence", () => {
    const evidence = videoEvidence([sceneEvidence(0), sceneEvidence(1)]);
    const asset = finalVideo(evidence);

    expect(finalVideoBrandLogoEvidencePassed(evidence, contract)).toBe(true);
    expect(aggregateBrandLogoEvidence([asset], contract)).toMatchObject({
      required: true,
      passed: true,
      failedAssets: [],
    });
  });

  it.each([
    ["a missing expected scene", videoEvidence([sceneEvidence(0)], 2)],
    ["duplicate scene indexes", videoEvidence([sceneEvidence(0), sceneEvidence(0)], 2)],
    ["one failed scene", videoEvidence([sceneEvidence(0), sceneEvidence(1, "FAIL")], 2)],
    ["missing aggregate counts", { ...videoEvidence([sceneEvidence(0), sceneEvidence(1)]), expectedSceneCount: null }],
  ])("fails closed for %s", (_label, evidence) => {
    const asset = finalVideo(evidence);
    expect(finalVideoBrandLogoEvidencePassed(evidence, contract)).toBe(false);
    expect(aggregateBrandLogoEvidence([asset], contract)).toMatchObject({
      required: true,
      passed: false,
      failedAssets: [asset],
    });
  });
});

describe("final-image brand-logo checksum lineage", () => {
  const baseChecksum = "a".repeat(64);
  const finalChecksum = "b".repeat(64);
  const exactEvidence = (): SocialBrandLogoEvidence => ({
    ...sceneEvidence(0),
    validatedAssetChecksumSha256: baseChecksum,
    validatedAsset: "openai_normalized_final",
    finalAssetPreservation: {
      method: "locked_safe_box_overlay_exclusion_v1",
      finalAssetRole: "final_publishable_asset",
      sourceValidationResponseId: "logo-scene-0",
      sourceValidatedAssetChecksumSha256: baseChecksum,
      finalPublishableAssetChecksumSha256: finalChecksum,
      pixelOverlayApplied: null,
      programmaticCopyOrBrandPixelsInsideExcludedBox: false,
      postGenerationLogoOverlayApplied: false,
    },
    allScenesPassed: null,
    validatedSceneCount: null,
    expectedSceneCount: null,
    sceneEvidence: [],
  });
  const exactAsset = (evidence = exactEvidence()): SocialAsset => ({
    role: "FINAL_COMPOSED",
    type: "feed_post",
    mediaKind: "IMAGE",
    mimeType: "image/jpeg",
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    url: "/uploads/social/final.jpg",
    finalUrl: "/uploads/social/final.jpg",
    previewUrl: "/uploads/social/final.jpg",
    checksumSha256: finalChecksum,
    provenance: { base_image: { checksum_sha256: baseChecksum } },
    brandLogoEvidence: evidence,
  } as unknown as SocialAsset);

  it("requires the validated source checksum to reach the exact-overlay final checksum through preservation evidence", () => {
    expect(assetBrandLogoState(exactAsset(), contract).passed).toBe(true);
    expect(assetBrandLogoState(exactAsset({
      ...exactEvidence(),
      finalAssetPreservation: {
        ...exactEvidence().finalAssetPreservation!,
        finalPublishableAssetChecksumSha256: "c".repeat(64),
      },
    }), contract).passed).toBe(false);
    expect(assetBrandLogoState(exactAsset({
      ...exactEvidence(),
      validatedAssetChecksumSha256: "d".repeat(64),
    }), contract).passed).toBe(false);
  });

  it("requires byte-identical source/final lineage for a native Full-AI graphic", () => {
    const evidence: SocialBrandLogoEvidence = {
      ...exactEvidence(),
      validatedAssetChecksumSha256: finalChecksum,
      validatedAsset: "final_publishable_asset",
      finalAssetPreservation: {
        method: "checksum_identical_ai_passthrough_v1",
        finalAssetRole: "",
        sourceValidationResponseId: "logo-scene-0",
        sourceValidatedAssetChecksumSha256: finalChecksum,
        finalPublishableAssetChecksumSha256: finalChecksum,
        pixelOverlayApplied: false,
        programmaticCopyOrBrandPixelsInsideExcludedBox: null,
        postGenerationLogoOverlayApplied: false,
      },
    };
    const asset = {
      ...exactAsset(evidence),
      visualMode: "FULL_AI_GRAPHIC",
      provenance: {
        full_ai_graphic_contract_version: 3,
        base_image: { checksum_sha256: finalChecksum },
        overlay: { method: "none", pixel_overlay_applied: false },
      },
    } as SocialAsset;

    expect(assetBrandLogoState(asset, contract).passed).toBe(true);
    expect(assetBrandLogoState({
      ...asset,
      provenance: {
        ...asset.provenance,
        base_image: { checksum_sha256: baseChecksum },
      },
    }, contract).passed).toBe(false);
  });
});
