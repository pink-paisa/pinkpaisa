const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const CANONICAL_BRAND_BADGE_ID = "pink-paisa-profile-badge-v1";
const CANONICAL_BRAND_BADGE_SHA256 = "0cf39611014a2e674bec396a43335f023c803aaffb61256c004bfcb6fabc92e9";
const AI_BRANDED_ARTWORK_MODE = "AI_BRANDED_ARTWORK";
const BRAND_LOGO_CONTRACT_VERSION = 1;
const ALLOWED_CORNERS = Object.freeze(["TOP_LEFT", "TOP_RIGHT", "BOTTOM_LEFT", "BOTTOM_RIGHT"]);
const REFERENCE_RELATIVE_PATH = "frontend-next/src/assets/pink-paisa-logo.png";

const BRAND_LOGO_POLICY = Object.freeze({
  contract_version: BRAND_LOGO_CONTRACT_VERSION,
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
  alpha_required: true,
  source_path: REFERENCE_RELATIVE_PATH,
  generation_method: "openai_images_edit_reference",
  input_fidelity: "high",
  placement_strategy: "ADAPTIVE_SAFE_CORNER_LOCKED_PER_DRAFT",
  locked_corner: null,
  target_width_px: 210,
  accepted_width_range_px: Object.freeze([180, 240]),
  readiness_status: "VERIFY_BEFORE_GENERATION",
  occurrence_count: 1,
  post_generation_logo_overlay_allowed: false,
  allowed_corners: ALLOWED_CORNERS,
});

function trimText(value) {
  return String(value || "").trim();
}

function policyError(message, code = "social_brand_logo_reference_invalid") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function repositoryRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function defaultReferencePath() {
  return path.resolve(repositoryRoot(), ...REFERENCE_RELATIVE_PATH.split("/"));
}

function referenceCandidates(logoPath) {
  const explicit = trimText(logoPath);
  const environment = trimText(process.env.SOCIAL_BRAND_LOGO_PATH);
  if (explicit) return [path.resolve(explicit)];
  if (environment) return [path.resolve(environment)];
  return [
    defaultReferencePath(),
    path.resolve(repositoryRoot(), "frontend-next", "public", "pink-paisa-logo.png"),
  ];
}

async function readFirstReference(candidates, dependencies = {}) {
  const readFile = dependencies.readFile || fs.promises.readFile;
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return { buffer: await readFile(candidate), sourcePath: candidate };
    } catch (error) {
      lastError = error;
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const error = policyError(
    "The canonical Pink Paisa profile badge is missing; generation was stopped before a paid image call",
    "social_brand_logo_reference_missing",
  );
  error.cause = lastError;
  throw error;
}

async function verifyBrandLogoReference({ logoPath = null, dependencies = {} } = {}) {
  let loaded;
  try {
    loaded = await readFirstReference(referenceCandidates(logoPath), dependencies);
  } catch (cause) {
    if (cause?.code === "social_brand_logo_reference_missing") throw cause;
    const error = policyError(`The canonical Pink Paisa profile badge could not be read: ${cause.message}`);
    error.cause = cause;
    throw error;
  }
  const { buffer, sourcePath } = loaded;
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
    throw policyError("The canonical Pink Paisa profile badge is empty or unreadable");
  }
  const checksum = sha256(buffer);
  if (checksum !== CANONICAL_BRAND_BADGE_SHA256) {
    throw policyError("The Pink Paisa profile badge checksum does not match the approved canonical asset");
  }
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== pngSignature) {
    throw policyError("The canonical Pink Paisa profile badge must be a PNG file");
  }
  let metadata;
  try {
    metadata = dependencies.readImageMetadata
      ? await dependencies.readImageMetadata(buffer)
      : await sharp(buffer, { failOn: "error", limitInputPixels: 2_000_000 }).metadata();
  } catch (cause) {
    const error = policyError(`The canonical Pink Paisa profile badge could not be inspected: ${cause.message}`);
    error.cause = cause;
    throw error;
  }
  if (
    trimText(metadata?.format).toLowerCase() !== "png"
    || Number(metadata?.width) !== BRAND_LOGO_POLICY.width
    || Number(metadata?.height) !== BRAND_LOGO_POLICY.height
    || metadata?.hasAlpha !== true
    || Number(metadata?.channels || 0) < 4
  ) {
    throw policyError("The canonical Pink Paisa profile badge must be the approved 512x512 PNG with an alpha channel");
  }
  const relativeSource = path.relative(repositoryRoot(), sourcePath).replace(/\\/g, "/");
  return {
    badge_id: CANONICAL_BRAND_BADGE_ID,
    checksum_sha256: checksum,
    mime_type: "image/png",
    width: 512,
    height: 512,
    has_alpha: true,
    file_size_bytes: buffer.length,
    source_path: relativeSource.startsWith("..") ? REFERENCE_RELATIVE_PATH : relativeSource,
    file_name: `${CANONICAL_BRAND_BADGE_ID}.png`,
    buffer,
    verified: true,
  };
}

async function attachVerifiedBrandLogoReadiness(settings = {}, { dependencies = {} } = {}) {
  const visualBrand = settings.visual_brand || {};
  const logoPolicy = visualBrand.logo_policy || {};
  try {
    const reference = await verifyBrandLogoReference({ dependencies });
    return {
      ...settings,
      visual_brand: {
        ...visualBrand,
        use_logo: true,
        logo_policy: {
          ...logoPolicy,
          reference_asset_id: reference.badge_id,
          reference_checksum_sha256: reference.checksum_sha256,
          reference_mime_type: reference.mime_type,
          reference_width: reference.width,
          reference_height: reference.height,
          reference_url: "/pink-paisa-logo.png",
          readiness_status: "VERIFIED",
          readiness_error_code: null,
        },
      },
    };
  } catch (error) {
    return {
      ...settings,
      visual_brand: {
        ...visualBrand,
        use_logo: true,
        logo_policy: {
          ...logoPolicy,
          reference_url: "/pink-paisa-logo.png",
          readiness_status: "FAILED",
          readiness_error_code: trimText(error?.code) || "social_brand_logo_reference_invalid",
        },
      },
    };
  }
}

function normalizeCorner(value) {
  const normalized = trimText(value).toUpperCase().replace(/[\s-]+/g, "_");
  const aliases = {
    UPPER_LEFT: "TOP_LEFT",
    UPPER_RIGHT: "TOP_RIGHT",
    LOWER_LEFT: "BOTTOM_LEFT",
    LOWER_RIGHT: "BOTTOM_RIGHT",
  };
  const corner = aliases[normalized] || normalized;
  return ALLOWED_CORNERS.includes(corner) ? corner : null;
}

function extractPersistedCorner(draftLike = {}) {
  return normalizeCorner(
    draftLike.brand_logo_contract?.locked_corner
    || draftLike.brandLogoContract?.lockedCorner
    || draftLike.brand_logo_contract?.safe_corner?.corner
    || draftLike.brandLogoContract?.safeCorner?.corner
    || draftLike.brand_logo_safe_corner?.corner
    || draftLike.brandLogoSafeCorner?.corner
    || draftLike.brand_logo_corner
    || draftLike.brandLogoCorner,
  );
}

function extractFrozenSafeCorner(draftLike = {}, format = "SINGLE_IMAGE") {
  const contract = draftLike.brand_logo_contract || draftLike.brandLogoContract || null;
  const safeCorner = contract?.safe_corner || contract?.safeCorner || null;
  const corner = normalizeCorner(
    contract?.locked_corner
    || contract?.lockedCorner
    || safeCorner?.corner,
  );
  const lockId = trimText(safeCorner?.lock_id || safeCorner?.lockId);
  const targetBox = safeCorner?.target_box || safeCorner?.targetBox || null;
  if (!corner || !lockId || !targetBox) return null;

  const expectedTargetBox = targetBoxForCorner(corner, format);
  const targetBoxKeys = [
    "canvas_width",
    "canvas_height",
    "left",
    "top",
    "width",
    "height",
    "minimum_clear_space_px",
  ];
  const targetBoxMatches = targetBoxKeys.every((key) => (
    Number.isFinite(Number(targetBox[key]))
    && Number(targetBox[key]) === Number(expectedTargetBox[key])
  ));
  if (!targetBoxMatches) {
    throw policyError(
      "The frozen Pink Paisa logo safe-area contract does not match the approved output format",
      "social_brand_logo_contract_mismatch",
    );
  }

  return {
    corner,
    target_box: expectedTargetBox,
    lock_id: lockId,
    locked_to_draft: true,
    lock_source: trimText(safeCorner.lock_source || safeCorner.lockSource) || "persisted",
  };
}

function draftIdentity(draftLike = {}, recommendation = {}) {
  return trimText(
    draftLike.idempotency_key
    || draftLike.idempotencyKey
    || draftLike._id
    || draftLike.id
    || draftLike.bundle_id
    || draftLike.bundleId
    || `${draftLike.generation_date || draftLike.generationDate || "undated"}:${recommendation.topic || recommendation.title || recommendation.format || "social"}`,
  );
}

function collectPlacementText(value, key = "", depth = 0, rows = []) {
  if (depth > 5 || rows.length >= 120 || value == null) return rows;
  if (typeof value === "string") {
    if (/position|placement|safe|corner|overlay|layout|logo|headline|copy/i.test(key)) rows.push(`${key}: ${value}`);
    return rows;
  }
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((item) => collectPlacementText(item, key, depth + 1, rows));
    return rows;
  }
  if (typeof value === "object") {
    Object.entries(value).slice(0, 80).forEach(([childKey, child]) => (
      collectPlacementText(child, childKey, depth + 1, rows)
    ));
  }
  return rows;
}

function cornerFromPlacementText(text) {
  const normalized = trimText(text).toLowerCase();
  if (!normalized) return null;
  if (/(?:top|upper)[\s_-]*(?:right)/.test(normalized)) return "TOP_RIGHT";
  if (/(?:top|upper)[\s_-]*(?:left)/.test(normalized)) return "TOP_LEFT";
  if (/(?:bottom|lower)[\s_-]*(?:right)/.test(normalized)) return "BOTTOM_RIGHT";
  if (/(?:bottom|lower)[\s_-]*(?:left)/.test(normalized)) return "BOTTOM_LEFT";
  return null;
}

function targetBoxForCorner(corner, format) {
  const normalizedFormat = trimText(format).toUpperCase();
  const vertical = ["STORY", "REEL", "VIDEO_FEED"].includes(normalizedFormat);
  const canvas = vertical ? { width: 1080, height: 1920 } : { width: 1080, height: 1350 };
  const size = 210;
  const isVideo = ["REEL", "VIDEO_FEED"].includes(normalizedFormat);
  const leftX = 64;
  const rightX = isVideo ? 710 : 806;
  const topY = vertical ? 250 : 64;
  const bottomY = normalizedFormat === "STORY" ? 1460 : isVideo ? 1290 : 1076;
  const box = {
    canvas_width: canvas.width,
    canvas_height: canvas.height,
    left: corner.endsWith("RIGHT") ? rightX : leftX,
    top: corner.startsWith("BOTTOM") ? bottomY : topY,
    width: size,
    height: size,
    minimum_clear_space_px: 24,
  };
  const rightEdge = box.left + box.width;
  const bottomEdge = box.top + box.height;
  const valid = box.width >= 180
    && box.width <= 240
    && (!vertical ? box.left >= 64 && rightEdge <= canvas.width - 64 : true)
    && (normalizedFormat !== "STORY" || (box.top >= 250 && bottomEdge <= 1670))
    && (!isVideo || (rightEdge <= 920 && bottomEdge <= 1500));
  if (!valid) {
    throw policyError(
      `No compliant ${normalizedFormat || "feed"} safe-corner box is available for the canonical Pink Paisa badge`,
      "social_brand_logo_safe_corner_unavailable",
    );
  }
  return box;
}

function chooseBrandLogoCorner({ draftLike = {}, recommendation = {}, preferredCorner = null, visualMode = null } = {}) {
  const format = trimText(recommendation.format || draftLike.format).toUpperCase() || "SINGLE_IMAGE";
  const effectiveVisualMode = trimText(
    visualMode
    || recommendation.visual_mode
    || recommendation.visualMode
    || recommendation.visualBrief?.visualMode
    || recommendation.visual_brief?.visual_mode
    || recommendation.visual_brief?.visualMode
    || draftLike.visual_mode
    || draftLike.visualMode,
  ).toUpperCase();
  const identity = draftIdentity(draftLike, recommendation);
  const frozenSafeCorner = extractFrozenSafeCorner(draftLike, format);
  const persisted = frozenSafeCorner?.corner || extractPersistedCorner(draftLike);
  const preferred = normalizeCorner(preferredCorner);
  const placementRows = collectPlacementText({
    visualBrief: recommendation.visualBrief || recommendation.visual_brief,
    formatContent: recommendation.formatContent || recommendation.format_content,
  });
  const explicitLogoRow = placementRows.find((row) => /logo/i.test(row) && cornerFromPlacementText(row));
  const instructed = explicitLogoRow ? cornerFromPlacementText(explicitLogoRow) : null;
  const occupied = new Set(
    placementRows
      .filter((row) => !/logo/i.test(row))
      .map(cornerFromPlacementText)
      .filter(Boolean),
  );
  const productCreative = format === "PRODUCT_FEATURE"
    || Boolean(trimText(recommendation.verifiedProductId || recommendation.verified_product_id));
  const exactCopyOverlay = effectiveVisualMode === "AI_VISUAL_WITH_EXACT_OVERLAY";
  if (exactCopyOverlay) {
    // These are the deterministic compositor's occupied regions. Treat them
    // as hard constraints before the paid request, rather than relying on the
    // model to guess where later Sharp copy/sequence pixels will land.
    if (["STORY", "REEL", "VIDEO_FEED"].includes(format)) {
      occupied.add("BOTTOM_LEFT");
      occupied.add("BOTTOM_RIGHT");
      const sequenceCount = Array.isArray(recommendation.formatContent?.frames)
        ? recommendation.formatContent.frames.length
        : Array.isArray(recommendation.format_content?.frames)
          ? recommendation.format_content.frames.length
          : 1;
      if (format === "STORY" && sequenceCount > 1) occupied.add("TOP_RIGHT");
    } else if (productCreative) {
      occupied.add("TOP_LEFT");
      occupied.add("BOTTOM_LEFT");
      occupied.add("BOTTOM_RIGHT");
    } else {
      occupied.add("TOP_LEFT");
      occupied.add("TOP_RIGHT");
      occupied.add("BOTTOM_LEFT");
    }
  }
  const formatOrder = productCreative
    ? ["TOP_RIGHT", "TOP_LEFT", "BOTTOM_LEFT"]
    : ["STORY", "REEL", "VIDEO_FEED"].includes(format)
      ? ["TOP_RIGHT", "TOP_LEFT", "BOTTOM_RIGHT", "BOTTOM_LEFT"]
      : ["TOP_RIGHT", "TOP_LEFT", "BOTTOM_LEFT", "BOTTOM_RIGHT"];
  const available = formatOrder.filter((corner) => !occupied.has(corner));
  if (!persisted && !available.length) {
    throw policyError(
      `No unoccupied ${format || "feed"} safe corner is available for the canonical Pink Paisa badge`,
      "social_brand_logo_safe_corner_unavailable",
    );
  }
  const candidates = available.length ? available : formatOrder;
  const digest = crypto.createHash("sha256").update(`${CANONICAL_BRAND_BADGE_ID}:${identity}:${format}`).digest();
  const usablePreferred = preferred && !occupied.has(preferred) ? preferred : null;
  const usableInstruction = instructed && !occupied.has(instructed) ? instructed : null;
  const corner = persisted || usablePreferred || usableInstruction || candidates[digest[0] % candidates.length];
  const lockSource = persisted
    ? "persisted"
    : usablePreferred
      ? "preferred"
      : usableInstruction ? "approved_direction" : "deterministic_adaptive";
  const lockId = frozenSafeCorner?.lock_id
    || crypto.createHash("sha256").update(`${CANONICAL_BRAND_BADGE_ID}:${identity}:${corner}`).digest("hex");
  return {
    corner,
    target_box: frozenSafeCorner?.target_box || targetBoxForCorner(corner, format),
    lock_id: lockId,
    locked_to_draft: true,
    lock_source: frozenSafeCorner?.lock_source || lockSource,
  };
}

function serializeBrandLogoContract(contract = {}) {
  const reference = contract.reference || {};
  const safeCorner = contract.safe_corner || contract.safeCorner || {};
  const lockedCorner = normalizeCorner(contract.locked_corner || safeCorner.corner);
  return {
    contract_version: Number(contract.contract_version || BRAND_LOGO_CONTRACT_VERSION),
    policy_version: "pink-paisa-mandatory-ai-baked-v1",
    required: true,
    method: "AI_REFERENCE_BAKED",
    reference_asset_id: trimText(contract.reference_asset_id || contract.badge_id || reference.badge_id),
    reference_checksum_sha256: trimText(
      contract.reference_checksum_sha256 || contract.checksum_sha256 || reference.checksum_sha256,
    ).toLowerCase(),
    reference_mime_type: trimText(contract.reference_mime_type || contract.mime_type || reference.mime_type),
    reference_width: Number(contract.reference_width || contract.width || reference.width),
    reference_height: Number(contract.reference_height || contract.height || reference.height),
    badge_id: trimText(contract.badge_id || contract.reference_asset_id || reference.badge_id),
    checksum_sha256: trimText(
      contract.checksum_sha256 || contract.reference_checksum_sha256 || reference.checksum_sha256,
    ).toLowerCase(),
    mime_type: trimText(contract.mime_type || contract.reference_mime_type || reference.mime_type),
    width: Number(contract.width || contract.reference_width || reference.width),
    height: Number(contract.height || contract.reference_height || reference.height),
    has_alpha: (contract.has_alpha ?? reference.has_alpha) === true,
    source_path: trimText(contract.source_path || reference.source_path),
    generation_method: "openai_images_edit_reference",
    input_fidelity: "high",
    placement_strategy: "ADAPTIVE_SAFE_CORNER_LOCKED_PER_DRAFT",
    locked_corner: lockedCorner,
    target_width_px: 210,
    accepted_width_range_px: [180, 240],
    readiness_status: "VERIFIED",
    occurrence_count: 1,
    safe_corner: {
      corner: lockedCorner,
      target_box: safeCorner.target_box || safeCorner.targetBox || null,
      lock_id: trimText(safeCorner.lock_id || safeCorner.lockId),
      locked_to_draft: safeCorner.locked_to_draft !== false,
      lock_source: trimText(safeCorner.lock_source || safeCorner.lockSource) || null,
    },
    post_generation_logo_overlay_applied: false,
  };
}

async function buildBrandLogoContract({
  draftLike = {},
  recommendation = {},
  preferredCorner = null,
  visualMode = null,
  logoPath = null,
  dependencies = {},
} = {}) {
  const reference = await verifyBrandLogoReference({ logoPath, dependencies });
  const safeCorner = chooseBrandLogoCorner({ draftLike, recommendation, preferredCorner, visualMode });
  const contract = {
    contract_version: BRAND_LOGO_CONTRACT_VERSION,
    policy_version: "pink-paisa-mandatory-ai-baked-v1",
    required: true,
    method: "AI_REFERENCE_BAKED",
    reference_asset_id: reference.badge_id,
    reference_checksum_sha256: reference.checksum_sha256,
    reference_mime_type: reference.mime_type,
    reference_width: reference.width,
    reference_height: reference.height,
    badge_id: reference.badge_id,
    checksum_sha256: reference.checksum_sha256,
    mime_type: reference.mime_type,
    width: reference.width,
    height: reference.height,
    has_alpha: reference.has_alpha,
    source_path: reference.source_path,
    generation_method: "openai_images_edit_reference",
    input_fidelity: "high",
    placement_strategy: "ADAPTIVE_SAFE_CORNER_LOCKED_PER_DRAFT",
    locked_corner: safeCorner.corner,
    target_width_px: 210,
    accepted_width_range_px: [180, 240],
    readiness_status: "VERIFIED",
    occurrence_count: 1,
    post_generation_logo_overlay_allowed: false,
    safe_corner: safeCorner,
    reference,
  };
  contract.serialized = serializeBrandLogoContract(contract);
  return contract;
}

function brandLogoEvidencePassed(validation = {}, contract = BRAND_LOGO_POLICY, expectedAssetChecksum = null) {
  const expected = serializeBrandLogoContract(contract);
  const identityChecks = validation.identity_checks || validation.identityChecks || {};
  const evidenceValue = (camelName, snakeName, canonicalName = snakeName) => {
    const direct = validation[camelName] ?? validation[snakeName];
    return direct === undefined ? identityChecks[canonicalName] : direct;
  };
  const observedCorner = normalizeCorner(validation.observedCorner || validation.observed_corner);
  const requestedCorner = normalizeCorner(
    validation.requestedCorner
    || validation.requested_corner
    || expected.locked_corner,
  );
  const responseIdentifier = trimText(
    validation.response_id
    || validation.responseId
    || validation.validator_response_id
    || validation.validatorResponseId,
  );
  const issues = Array.isArray(validation.issues) ? validation.issues.map(trimText).filter(Boolean) : [];
  const observedWidth = Number(
    validation.observedBadgeWidthPx
    ?? validation.observed_badge_width_px
    ?? identityChecks.observed_badge_width_px,
  );
  const boundingBox = validation.normalizedBoundingBox || validation.normalized_bounding_box || {};
  const normalizedBoundingBoxIsValid = ["x", "y", "width", "height"].every((key) => (
    Number.isFinite(Number(boundingBox[key]))
  ))
    && Number(boundingBox.x) >= 0
    && Number(boundingBox.y) >= 0
    && Number(boundingBox.width) > 0
    && Number(boundingBox.height) > 0
    && Number(boundingBox.x) + Number(boundingBox.width) <= 1
    && Number(boundingBox.y) + Number(boundingBox.height) <= 1;
  const targetBox = expected.safe_corner?.target_box || {};
  const canvasWidth = Number(targetBox.canvas_width);
  const canvasHeight = Number(targetBox.canvas_height);
  const expectedLeft = Number(targetBox.left);
  const expectedTop = Number(targetBox.top);
  const expectedWidth = Number(targetBox.width);
  const expectedHeight = Number(targetBox.height);
  const targetBoxIsValid = [canvasWidth, canvasHeight, expectedLeft, expectedTop, expectedWidth, expectedHeight]
    .every((value) => Number.isFinite(value) && value >= 0)
    && canvasWidth > 0
    && canvasHeight > 0
    && expectedWidth > 0
    && expectedHeight > 0;
  const observedPixelBox = normalizedBoundingBoxIsValid && targetBoxIsValid
    ? {
      left: Number(boundingBox.x) * canvasWidth,
      top: Number(boundingBox.y) * canvasHeight,
      width: Number(boundingBox.width) * canvasWidth,
      height: Number(boundingBox.height) * canvasHeight,
    }
    : null;
  const placementTolerancePx = 30;
  const observedBoxMatchesFrozenTarget = Boolean(observedPixelBox)
    && observedPixelBox.width >= 180
    && observedPixelBox.width <= 240
    && observedPixelBox.height >= 180
    && observedPixelBox.height <= 240
    && Math.abs((observedPixelBox.left + observedPixelBox.width / 2) - (expectedLeft + expectedWidth / 2)) <= placementTolerancePx
    && Math.abs((observedPixelBox.top + observedPixelBox.height / 2) - (expectedTop + expectedHeight / 2)) <= placementTolerancePx
    && observedPixelBox.left >= expectedLeft - placementTolerancePx
    && observedPixelBox.top >= expectedTop - placementTolerancePx
    && observedPixelBox.left + observedPixelBox.width <= expectedLeft + expectedWidth + placementTolerancePx
    && observedPixelBox.top + observedPixelBox.height <= expectedTop + expectedHeight + placementTolerancePx
    && Math.abs(observedPixelBox.width - observedWidth) <= 20;
  const decision = trimText(validation.decision || validation.outcome).toUpperCase();
  const badgeId = trimText(
    validation.badgeId
    || validation.badge_id
    || validation.referenceAssetId
    || validation.reference_asset_id,
  );
  const checksum = trimText(
    validation.referenceChecksumSha256
    || validation.reference_checksum_sha256,
  ).toLowerCase();
  const validatedAssetChecksum = trimText(
    validation.validatedAssetChecksumSha256
    || validation.validated_asset_checksum_sha256,
  ).toLowerCase();
  const expectedChecksum = trimText(expectedAssetChecksum).toLowerCase();
  const method = trimText(validation.method || expected.method).toUpperCase();
  const inputFidelity = trimText(
    validation.input_fidelity
    || validation.inputFidelity
    || expected.input_fidelity,
  ).toLowerCase();
  const unapprovedTextPresent = validation.unapprovedTextPresent ?? validation.unapproved_text_present;
  const unrelatedLogoOrWatermarkPresent = validation.unrelatedLogoOrWatermarkPresent
    ?? validation.unrelated_logo_or_watermark_present;
  const noUnapprovedText = typeof unapprovedTextPresent === "boolean"
    ? unapprovedTextPresent === false
    : identityChecks.no_unapproved_text === true;
  const noUnrelatedLogoOrWatermark = typeof unrelatedLogoOrWatermarkPresent === "boolean"
    ? unrelatedLogoOrWatermarkPresent === false
    : identityChecks.no_unrelated_logo_or_watermark === true;
  const protectedContentOverlapPresent = validation.protectedContentOverlapPresent
    ?? validation.protected_content_overlap_present
    ?? identityChecks.protected_content_overlap_present;
  const aiReferenceBakedEvidence = method === "AI_REFERENCE_BAKED"
    && inputFidelity === "high"
    && (validation.reference_used_for_generation ?? validation.referenceUsedForGeneration ?? true) === true;
  const externalReferenceVisualMatchEvidence = method === "EXTERNAL_REFERENCE_VISUAL_MATCH"
    && inputFidelity === "not_applicable"
    && (validation.reference_used_for_generation ?? validation.referenceUsedForGeneration) === false
    && (validation.reference_used_for_validation ?? validation.referenceUsedForValidation) === true
    && ["generated_without_reference", "generated_from_approved_source"].includes(
      trimText(validation.source_provenance || validation.sourceProvenance).toLowerCase(),
    );
  return ["PASS", "PASSED", "VALID", "VALIDATED", "SUCCEEDED"].includes(decision)
    && badgeId === CANONICAL_BRAND_BADGE_ID
    && badgeId === expected.reference_asset_id
    && checksum === CANONICAL_BRAND_BADGE_SHA256
    && checksum === expected.reference_checksum_sha256
    && (aiReferenceBakedEvidence || externalReferenceVisualMatchEvidence)
    && /^[a-f0-9]{64}$/.test(expectedChecksum)
    && /^[a-f0-9]{64}$/.test(validatedAssetChecksum)
    && validatedAssetChecksum === expectedChecksum
    && evidenceValue("approvedLogoPresent", "approved_logo_present") === true
    && evidenceValue("referenceIdentityMatch", "reference_identity_match") === true
    && evidenceValue("wordmarkExactMatch", "wordmark_exact_match") === true
    && evidenceValue("iconGeometryMatch", "icon_geometry_match") === true
    && evidenceValue("brandColourMatch", "brand_colour_match") === true
    && evidenceValue("registeredMarkRecognizable", "registered_mark_recognizable") === true
    && evidenceValue("singleBadgeOccurrence", "single_badge_occurrence") === true
    && Number(validation.observedBadgeCount ?? validation.observed_badge_count ?? validation.logo_count ?? validation.logoCount) === 1
    && evidenceValue("safeCornerMatch", "safe_corner_match") === true
    && evidenceValue("fullyInsideSafeBox", "fully_inside_safe_box") === true
    && evidenceValue("acceptedWidthRange", "accepted_width_range") === true
    && requestedCorner === expected.safe_corner.corner
    && observedCorner === expected.safe_corner.corner
    && observedWidth >= 180
    && observedWidth <= 240
    && normalizedBoundingBoxIsValid
    && observedBoxMatchesFrozenTarget
    && evidenceValue("mobileLegible", "mobile_legible") === true
    && protectedContentOverlapPresent === false
    && noUnapprovedText
    && noUnrelatedLogoOrWatermark
    && (validation.post_generation_logo_overlay_applied ?? validation.postGenerationLogoOverlayApplied) === false
    && issues.length === 0
    && Boolean(responseIdentifier);
}

function assertBrandLogoEvidenceForAssets(assets = [], { contract = null } = {}) {
  const rows = Array.isArray(assets) ? assets : [];
  if (!rows.length) throw policyError("At least one generated asset is required for brand-logo evidence", "social_brand_logo_evidence_invalid");
  for (const [index, asset] of rows.entries()) {
    const assetContract = contract
      || asset?.brand_logo_contract
      || asset?.brandLogoContract
      || asset?.provenance?.brand_logo_contract
      || asset?.provenance?.brandLogoContract;
    const evidence = asset?.brand_logo_evidence
      || asset?.brandLogoEvidence
      || asset?.brand_logo_validation
      || asset?.brandLogoValidation
      || asset?.provenance?.brand_logo_evidence
      || asset?.provenance?.brandLogoEvidence
      || asset?.provenance?.brand_logo_validation
      || asset?.provenance?.brandLogoValidation;
    const suppliedChecksum = trimText(asset?.checksum_sha256 || asset?.checksumSha256).toLowerCase();
    const expectedAssetChecksum = Buffer.isBuffer(asset?.buffer)
      ? sha256(asset.buffer)
      : suppliedChecksum || trimText(asset?.provenance?.base_image?.checksum_sha256).toLowerCase();
    const suppliedChecksumMatchesBytes = !Buffer.isBuffer(asset?.buffer)
      || (/^[a-f0-9]{64}$/.test(suppliedChecksum) && suppliedChecksum === expectedAssetChecksum);
    if (!assetContract || !suppliedChecksumMatchesBytes || !brandLogoEvidencePassed(evidence, assetContract, expectedAssetChecksum)) {
      const error = policyError(`Generated asset ${index + 1} does not retain strict canonical brand-logo evidence`, "social_brand_logo_evidence_invalid");
      error.asset_index = index;
      throw error;
    }
  }
  return true;
}

module.exports = {
  AI_BRANDED_ARTWORK_MODE,
  BRAND_LOGO_CONTRACT_VERSION,
  BRAND_LOGO_POLICY,
  CANONICAL_BRAND_BADGE_ID,
  CANONICAL_BRAND_BADGE_SHA256,
  attachVerifiedBrandLogoReadiness,
  assertBrandLogoEvidenceForAssets,
  brandLogoEvidencePassed,
  buildBrandLogoContract,
  chooseBrandLogoCorner,
  serializeBrandLogoContract,
  verifyBrandLogoReference,
  _private: {
    defaultReferencePath,
    draftIdentity,
    extractFrozenSafeCorner,
    normalizeCorner,
    referenceCandidates,
    targetBoxForCorner,
  },
};
