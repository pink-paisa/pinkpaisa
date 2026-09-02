import {
  SocialAsset,
  SocialBrandLogoContract,
  SocialBrandLogoEvidence,
  SocialBrandLogoSceneEvidence,
  SocialBrandLogoValidationEvidence,
} from "./types";

export const VALIDATED_AI_LOGO_LABEL = "Logo · AI-rendered from approved reference — validated";
export const VALIDATED_REFERENCE_MATCH_LOGO_LABEL = "Logo · Approved-reference visual match — validated";
export const INVALID_AI_LOGO_LABEL = "Logo · Missing or failed validation";
export const NO_LOGO_OVERLAY_LABEL = "Post-generation logo overlay · None";

const passingOutcomes = new Set(["PASS", "PASSED", "VALID", "VALIDATED", "SUCCEEDED"]);
const readyStatuses = new Set(["READY", "VERIFIED"]);
const canonicalReferenceAssetId = "pink-paisa-profile-badge-v1";
const canonicalReferenceChecksum = "0cf39611014a2e674bec396a43335f023c803aaffb61256c004bfcb6fabc92e9";
const sha256Pattern = /^[a-f0-9]{64}$/;

const normalized = (value: unknown) => String(value ?? "").trim().toUpperCase();
const normalizedCheckKey = (value: string) => value.replace(/[^a-z0-9]/gi, "").toUpperCase();

export const isPublishableSocialAsset = (asset: SocialAsset): boolean => {
  const role = normalized(asset.role);
  const mediaKind = normalized(asset.mediaKind);
  if (!asset.finalUrl && !asset.previewUrl && !asset.url) return false;
  if (role.includes("ORIGINAL") || role.includes("REFERENCE") || role.includes("SUBTITLE") || mediaKind === "AUDIO" || mediaKind === "SUBTITLE") return false;
  return role.includes("FINAL") || role.includes("PUBLISHABLE") || role === "STORY_FRAME" || role === "REEL_FRAME";
};

const identityChecksPass = (checks: SocialBrandLogoValidationEvidence["identityChecks"]): boolean => (
  Object.keys(checks).length > 0
  && !Object.entries(checks).some(([key, value]) => {
    if (normalizedCheckKey(key) === "PROTECTEDCONTENTOVERLAPPRESENT") return value !== false;
    return value === false || normalized(value) === "FAIL" || normalized(value) === "FAILED";
  })
);

const normalizedBoxPasses = (evidence: SocialBrandLogoValidationEvidence): boolean => {
  const box = evidence.normalizedBoundingBox;
  if (!box || [box.x, box.y, box.width, box.height].some((value) => value === null || !Number.isFinite(value))) return false;
  const { x, y, width, height } = box as { x: number; y: number; width: number; height: number };
  return x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1;
};

export const brandLogoEvidencePassed = (
  evidence: SocialBrandLogoValidationEvidence | null,
  contract?: SocialBrandLogoContract | null,
  expectedAssetChecksum?: string | null,
): boolean => {
  if (!evidence || !passingOutcomes.has(normalized(evidence.outcome))) return false;
  if (evidence.referenceAssetId !== canonicalReferenceAssetId
    || evidence.referenceChecksumSha256.toLowerCase() !== canonicalReferenceChecksum
    || evidence.logoCount !== 1) return false;
  if (!identityChecksPass(evidence.identityChecks)) return false;
  if (!normalizedBoxPasses(evidence)) return false;
  if (!evidence.requestedCorner || !evidence.observedCorner || normalized(evidence.requestedCorner) !== normalized(evidence.observedCorner)) return false;
  if (!evidence.validatorModel || !evidence.validatorResponseId) return false;
  const method = normalized(evidence.method);
  const fidelity = normalized(evidence.inputFidelity);
  const generationBacked = method === "AI_REFERENCE_BAKED"
    && fidelity === "HIGH"
    && evidence.referenceUsedForGeneration === true
    && evidence.referenceUsedForValidation === true;
  const externallyValidated = method === "EXTERNAL_REFERENCE_VISUAL_MATCH"
    && fidelity === "NOT_APPLICABLE"
    && evidence.referenceUsedForGeneration === false
    && evidence.referenceUsedForValidation === true
    && ["generated_without_reference", "generated_from_approved_source"].includes(evidence.sourceProvenance.toLowerCase());
  if (!generationBacked && !externallyValidated) return false;
  const expectedChecksum = String(expectedAssetChecksum || "").trim().toLowerCase();
  if (!sha256Pattern.test(expectedChecksum)
    || !sha256Pattern.test(evidence.validatedAssetChecksumSha256)
    || evidence.validatedAssetChecksumSha256 !== expectedChecksum) return false;
  if (evidence.postGenerationLogoOverlayApplied !== false) return false;
  if (evidence.registeredMarkRecognizable === false || evidence.protectedContentOverlapPresent === true) return false;
  if ((evidence.issues || []).length > 0) return false;
  if (contract?.referenceAssetId && evidence.referenceAssetId !== contract.referenceAssetId) return false;
  if (contract?.referenceChecksumSha256
    && evidence.referenceChecksumSha256.toLowerCase() !== contract.referenceChecksumSha256.toLowerCase()) return false;
  if (contract?.lockedCorner && normalized(evidence.observedCorner) !== normalized(contract.lockedCorner)) return false;
  return true;
};

const logoValidationLabel = (evidence: SocialBrandLogoValidationEvidence | null): string => (
  normalized(evidence?.method) === "EXTERNAL_REFERENCE_VISUAL_MATCH"
    ? VALIDATED_REFERENCE_MATCH_LOGO_LABEL
    : VALIDATED_AI_LOGO_LABEL
);

const provenanceObject = (value: unknown): Record<string, unknown> => (
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

const provenanceValue = (source: Record<string, unknown>, snake: string, camel: string): unknown => (
  source[snake] ?? source[camel]
);

const finalImageBrandLogoEvidencePassed = (
  asset: SocialAsset,
  evidence: SocialBrandLogoEvidence,
  contract?: SocialBrandLogoContract | null,
): boolean => {
  const provenance = provenanceObject(asset.provenance);
  const baseImage = provenanceObject(provenanceValue(provenance, "base_image", "baseImage"));
  const overlay = provenanceObject(provenance.overlay);
  const assetChecksum = String(asset.checksumSha256 || "").trim().toLowerCase();
  const baseImageChecksum = String(provenanceValue(baseImage, "checksum_sha256", "checksumSha256") || "").trim().toLowerCase();
  const fullAiContractVersion = Number(provenanceValue(provenance, "full_ai_graphic_contract_version", "fullAiGraphicContractVersion") || 0);
  const nativeFullAi = normalized(asset.visualMode) === "FULL_AI_GRAPHIC" && [2, 3].includes(fullAiContractVersion);
  const expectedChecksum = nativeFullAi ? assetChecksum : baseImageChecksum;
  if (!brandLogoEvidencePassed(evidence, contract, expectedChecksum)) return false;

  const preservation = evidence.finalAssetPreservation;
  if (!preservation || !sha256Pattern.test(assetChecksum) || !sha256Pattern.test(baseImageChecksum)) return false;
  if (nativeFullAi) {
    return overlay.method === "none"
      && provenanceValue(overlay, "pixel_overlay_applied", "pixelOverlayApplied") === false
      && baseImageChecksum === assetChecksum
      && evidence.validatedAsset === "final_publishable_asset"
      && preservation.method === "checksum_identical_ai_passthrough_v1"
      && preservation.sourceValidatedAssetChecksumSha256 === assetChecksum
      && preservation.finalPublishableAssetChecksumSha256 === assetChecksum
      && preservation.pixelOverlayApplied === false
      && preservation.postGenerationLogoOverlayApplied === false;
  }
  return ["openai_normalized_final", "openai_normalized_with_authentic_product_final"].includes(evidence.validatedAsset)
    && preservation.method === "locked_safe_box_overlay_exclusion_v1"
    && preservation.finalAssetRole === "final_publishable_asset"
    && preservation.sourceValidatedAssetChecksumSha256 === baseImageChecksum
    && preservation.finalPublishableAssetChecksumSha256 === assetChecksum
    && preservation.programmaticCopyOrBrandPixelsInsideExcludedBox === false
    && preservation.postGenerationLogoOverlayApplied === false;
};

export const isFinalVideoBrandAsset = (asset: SocialAsset): boolean => (
  normalized(asset.role) === "FINAL_VIDEO"
);

export const finalVideoBrandLogoEvidencePassed = (
  evidence: SocialBrandLogoEvidence | null,
  contract?: SocialBrandLogoContract | null,
): boolean => {
  if (!evidence) return false;
  const expectedSceneCount = evidence.expectedSceneCount;
  if (!Number.isInteger(expectedSceneCount) || Number(expectedSceneCount) < 1) return false;
  const expected = Number(expectedSceneCount);
  if (evidence.allScenesPassed !== true || evidence.validatedSceneCount !== expected || evidence.sceneEvidence.length !== expected) return false;
  const sceneIndexes = evidence.sceneEvidence.map((scene) => scene.sceneIndex);
  if (sceneIndexes.some((sceneIndex) => !Number.isInteger(sceneIndex))) return false;
  const uniqueIndexes = new Set(sceneIndexes as number[]);
  if (uniqueIndexes.size !== expected || Array.from({ length: expected }, (_, index) => index).some((index) => !uniqueIndexes.has(index))) return false;
  return evidence.sceneEvidence.every((scene) => brandLogoEvidencePassed(
    scene,
    contract,
    scene.extractedFrameChecksumSha256,
  ));
};

export const brandLogoSceneEvidenceState = (
  scene: SocialBrandLogoSceneEvidence,
  contract?: SocialBrandLogoContract | null,
): { passed: boolean; label: string } => {
  const passed = brandLogoEvidencePassed(scene, contract, scene.extractedFrameChecksumSha256);
  return { passed, label: passed ? logoValidationLabel(scene) : INVALID_AI_LOGO_LABEL };
};

export const brandLogoContractReady = (
  contract: SocialBrandLogoContract | null | undefined,
  requireLockedCorner = false,
): boolean => Boolean(
  contract
  && contract.contractVersion === 1
  && contract.policyVersion === "pink-paisa-mandatory-ai-baked-v1"
  && contract.required
  && normalized(contract.method) === "AI_REFERENCE_BAKED"
  && contract.referenceAssetId === canonicalReferenceAssetId
  && contract.referenceChecksumSha256.toLowerCase() === canonicalReferenceChecksum
  && contract.referenceMimeType === "image/png"
  && contract.referenceWidth === 512
  && contract.referenceHeight === 512
  && contract.inputFidelity.toLowerCase() === "high"
  && normalized(contract.placementStrategy) === "ADAPTIVE_SAFE_CORNER_LOCKED_PER_DRAFT"
  && (!requireLockedCorner || Boolean(contract.lockedCorner))
  && contract.targetWidthPx === 210
  && contract.acceptedWidthRangePx.length === 2
  && contract.acceptedWidthRangePx[0] === 180
  && contract.acceptedWidthRangePx[1] === 240
  && readyStatuses.has(normalized(contract.readinessStatus)),
);

export type SocialAssetBrandLogoState = {
  required: boolean;
  passed: boolean;
  legacy: boolean;
  labels: string[];
};

export const assetBrandLogoState = (
  asset: SocialAsset,
  contract?: SocialBrandLogoContract | null,
): SocialAssetBrandLogoState => {
  const evidence = asset.brandLogoEvidence;
  const required = Boolean(contract?.required || evidence);
  if (!required) return { required: false, passed: true, legacy: true, labels: [] };
  const passed = isFinalVideoBrandAsset(asset)
    ? finalVideoBrandLogoEvidencePassed(evidence, contract)
    : evidence ? finalImageBrandLogoEvidencePassed(asset, evidence, contract) : false;
  const labels = [passed ? logoValidationLabel(evidence) : INVALID_AI_LOGO_LABEL];
  if (evidence?.postGenerationLogoOverlayApplied === false) labels.push(NO_LOGO_OVERLAY_LABEL);
  return { required, passed, legacy: false, labels };
};

export type SocialBrandLogoAggregate = {
  required: boolean;
  passed: boolean;
  legacy: boolean;
  publishableAssets: SocialAsset[];
  failedAssets: SocialAsset[];
  labels: string[];
};

export const aggregateBrandLogoEvidence = (
  assets: SocialAsset[],
  contract?: SocialBrandLogoContract | null,
): SocialBrandLogoAggregate => {
  const publishableAssets = assets.filter(isPublishableSocialAsset);
  const required = Boolean(contract?.required || publishableAssets.some((asset) => asset.brandLogoEvidence));
  if (!required) return { required: false, passed: true, legacy: true, publishableAssets, failedAssets: [], labels: [] };
  const failedAssets = publishableAssets.filter((asset) => !assetBrandLogoState(asset, contract).passed);
  const passed = publishableAssets.length > 0 && failedAssets.length === 0;
  const labels = passed
    ? Array.from(new Set(publishableAssets.flatMap((asset) => assetBrandLogoState(asset, contract).labels)
      .filter((label) => label !== NO_LOGO_OVERLAY_LABEL)))
    : [INVALID_AI_LOGO_LABEL];
  if (publishableAssets.length > 0 && publishableAssets.every((asset) => asset.brandLogoEvidence?.postGenerationLogoOverlayApplied === false)) {
    labels.push(NO_LOGO_OVERLAY_LABEL);
  }
  return { required, passed, legacy: false, publishableAssets, failedAssets, labels };
};

export const brandLogoAssetSequenceLabel = (asset: SocialAsset, format: string, fallbackIndex: number): string => {
  const sequence = asset.slideNumber || fallbackIndex + 1;
  const normalizedFormat = normalized(format);
  if (normalizedFormat === "STORY" || asset.role.toUpperCase() === "STORY_FRAME") return `Frame ${sequence}`;
  if (normalizedFormat === "CAROUSEL") return `Slide ${sequence}`;
  if (["REEL", "VIDEO_FEED"].includes(normalizedFormat) && asset.mediaKind.toUpperCase() !== "VIDEO") return `Frame ${sequence}`;
  return `Asset ${sequence}`;
};
