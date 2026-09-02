const crypto = require("crypto");
const fs = require("fs");
const mongoose = require("mongoose");
const os = require("os");
const Product = require("../../models/Product");
const SocialAsset = require("../../models/SocialAsset");
const SocialAudioTrack = require("../../models/SocialAudioTrack");
const SocialAuditLog = require("../../models/SocialAuditLog");
const SocialManualAction = require("../../models/SocialManualAction");
const SocialPostDraft = require("../../models/SocialPostDraft");
const SocialPublication = require("../../models/SocialPublication");
const logger = require("../../utils/logger");
const {
  getInstagramConnectionSummary,
  isPublicMediaUrl,
  publishInstagramDraft,
} = require("../instagramPublishService");
const { getGeneratedCampaignAssetReference } = require("../campaignAssetStorage");
const {
  buildPublicationFingerprint,
  scanRecommendationCompliance,
  trimText,
  validateLandingPage,
} = require("./socialCompliance");
const { assertWeeklyPublicationCapacity } = require("./socialWeeklyLimit");
const { syncWeeklyPlanFromDraft } = require("./socialWeeklyPlanSyncService");
const {
  buildSocialCaptionContract,
  isAffiliateRecommendation,
} = require("./socialCaptionPolicy");
const { brandLogoEvidencePassed } = require("./socialBrandLogoPolicy");

const REQUIRED_PUBLISH_SCOPE_NAMES = new Set([
  "instagram_business_content_publish",
  "instagram_content_publish",
]);
const PUBLICATION_WORKER_OWNER = `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
const PUBLICATION_LEASE_MS = Math.max(Number(process.env.SOCIAL_MANAGER_PUBLICATION_LEASE_MS || 5 * 60 * 1000), 60 * 1000);
const PUBLICATION_IN_FLIGHT_STATUSES = new Set(["VALIDATING", "CONTAINER_CREATED", "PUBLISHING"]);

function actorId(actor) {
  return actor?._id || actor?.id || actor?.userId || null;
}

function applyMongoSession(query, session) {
  return session && query && typeof query.session === "function" ? query.session(session) : query;
}

async function createWithSession(Model, record, session) {
  if (!session) return Model.create(record);
  const created = await Model.create([record], { session });
  return Array.isArray(created) ? created[0] : created;
}

async function runPublishingTransaction(dependencies, work) {
  if (dependencies.mongoSession) return work(dependencies.mongoSession);
  const startSession = dependencies.startSession
    || (mongoose.connection?.readyState === 1 && typeof mongoose.startSession === "function"
      ? () => mongoose.startSession()
      : null);
  if (!startSession) return work(null);
  const session = await startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

function publishingError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function sha256File(filePath, { createReadStream = fs.createReadStream } = {}) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    let stream;
    try {
      stream = createReadStream(filePath, { flags: "r" });
    } catch (error) {
      reject(error);
      return;
    }
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["true", "1", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function publishingFeatureEnabled(settings = {}) {
  const envEnabled = parseBoolean(
    process.env.SOCIAL_MANAGER_PUBLISHING_ENABLED
      ?? process.env.SOCIAL_INSTAGRAM_PUBLISHING_ENABLED,
    false,
  );
  return envEnabled && settings.publishing?.enabled === true && settings.publishing?.provider === "INSTAGRAM_GRAPH";
}

function autoPublishEnabled(settings = {}) {
  return publishingFeatureEnabled(settings)
    && parseBoolean(process.env.SOCIAL_MANAGER_AUTO_PUBLISH ?? process.env.SOCIAL_AUTO_PUBLISH, false)
    && settings.publishing?.auto_publish === true;
}

function instagramContentType(format) {
  if (format === "CAROUSEL") return "carousel";
  if (format === "REEL") return "reel";
  if (format === "VIDEO_FEED") return "video_feed";
  if (format === "STORY") return "story";
  if (["SINGLE_IMAGE", "INFOGRAPHIC", "MEME", "QUIZ", "POLL", "POLL_CONCEPT", "PRODUCT_FEATURE", "RESOURCE_PROMOTION", "EVENT_OR_WORKSHOP_PROMOTION", "WORKSHOP_PROMOTION"].includes(format)) return "single_image";
  return null;
}

function storyOnFrameProvenancePassed(asset = {}) {
  const policy = asset.provenance?.caption_policy || {};
  if (policy.method === "story_frame_overlay") return true;
  const nativePoster = asset.provenance?.base_image?.poster_validation || {};
  return policy.method === "story_frame_ai_native"
    && policy.pixel_overlay_applied === false
    && policy.text_rendering === "openai_image_baked_in_exact_copy"
    && trimText(asset.visual_mode).toUpperCase() === "FULL_AI_GRAPHIC"
    && [2, 3].includes(Number(asset.provenance?.full_ai_graphic_contract_version || 0))
    && asset.provenance?.overlay?.method === "none"
    && asset.provenance?.overlay?.pixel_overlay_applied === false
    && asset.provenance?.final_pixel_contract?.pixel_overlay_applied === false
    && nativePoster.decision === "PASS"
    && nativePoster.exactTextMatch === true
    && nativePoster.unapprovedTextPresent === false
    && nativePoster.unrelatedLogoOrWatermarkPresent === false;
}

function brandLogoPublicationEvidencePassed({ draft = null, asset = {}, format = null } = {}) {
  const contract = draft?.brand_logo_contract || asset?.brand_logo_contract || asset?.provenance?.brand_logo_contract;
  if (!contract?.required) return true;
  if (contract.post_generation_logo_overlay_applied === true
    || asset?.provenance?.post_generation_logo_overlay_applied === true
    || asset?.provenance?.overlay?.logo_overlay_applied === true) return false;

  const mimeType = String(asset?.mime_type || asset?.mimeType || "").toLowerCase();
  if (mimeType.startsWith("video/") || ["REEL", "VIDEO_FEED"].includes(String(format || "").toUpperCase())) {
    const evidenceRows = Array.isArray(asset?.provenance?.brand_logo_scene_evidence)
      ? asset.provenance.brand_logo_scene_evidence
      : [];
    const expectedSceneCount = Math.max(
      Array.isArray(draft?.current_package?.primaryRecommendation?.formatContent?.scenes)
        ? draft.current_package.primaryRecommendation.formatContent.scenes.length
        : 0,
      1,
    );
    return evidenceRows.length === expectedSceneCount
      && evidenceRows.every((row, index) => {
        const evidence = row?.evidence || row;
        const extractedFrameChecksum = trimText(
          row?.extracted_frame_checksum_sha256
          || evidence?.extracted_frame_checksum_sha256,
        ).toLowerCase();
        return Number(row?.scene_index ?? evidence?.scene_index) === index
          && brandLogoEvidencePassed(evidence, contract, extractedFrameChecksum);
      });
  }

  const evidence = asset?.brand_logo_evidence
    || asset?.provenance?.brand_logo_evidence
    || asset?.provenance?.base_image?.brand_logo_evidence
    || asset?.provenance?.base_image?.brand_logo_validation;
  const nativeFullAi = trimText(asset?.visual_mode).toUpperCase() === "FULL_AI_GRAPHIC"
    && [2, 3].includes(Number(asset?.provenance?.full_ai_graphic_contract_version || 0));
  const assetChecksum = trimText(asset?.checksum_sha256 || asset?.checksumSha256).toLowerCase();
  const baseImageChecksum = trimText(
    asset?.provenance?.base_image?.checksum_sha256
    || asset?.provenance?.base_image?.checksumSha256,
  ).toLowerCase();
  const evidenceExpectedChecksum = nativeFullAi ? assetChecksum : baseImageChecksum;
  if (!brandLogoEvidencePassed(evidence || {}, contract, evidenceExpectedChecksum)) return false;
  const preservation = evidence?.final_asset_preservation || evidence?.finalAssetPreservation;
  if (nativeFullAi) {
    return asset?.provenance?.overlay?.method === "none"
      && asset?.provenance?.overlay?.pixel_overlay_applied === false
      && /^[a-f0-9]{64}$/.test(assetChecksum)
      && baseImageChecksum === assetChecksum
      && evidence?.validated_asset === "final_publishable_asset"
      && preservation?.method === "checksum_identical_ai_passthrough_v1"
      && trimText(preservation?.source_validated_asset_checksum_sha256).toLowerCase() === assetChecksum
      && trimText(preservation?.final_publishable_asset_checksum_sha256).toLowerCase() === assetChecksum
      && preservation?.pixel_overlay_applied === false
      && preservation?.post_generation_logo_overlay_applied === false;
  }
  return ["openai_normalized_final", "openai_normalized_with_authentic_product_final"].includes(evidence?.validated_asset)
    && preservation?.method === "locked_safe_box_overlay_exclusion_v1"
    && preservation?.final_asset_role === "final_publishable_asset"
    && /^[a-f0-9]{64}$/.test(assetChecksum)
    && /^[a-f0-9]{64}$/.test(baseImageChecksum)
    && trimText(preservation?.source_validated_asset_checksum_sha256).toLowerCase() === baseImageChecksum
    && trimText(preservation?.final_publishable_asset_checksum_sha256).toLowerCase() === assetChecksum
    && preservation?.programmatic_copy_or_brand_pixels_inside_excluded_box === false
    && preservation?.post_generation_logo_overlay_applied === false;
}

function brandLogoAssetIntegrityError(asset = {}, reason, details = {}) {
  const sequence = Number(asset?.slide_number || asset?.slideNumber || 1);
  const error = publishingError(
    `The final publication asset at sequence ${sequence} could not be verified against its approved SHA-256 checksum. Regenerate and review this asset before publishing.`,
    "social_brand_logo_asset_integrity_invalid",
    409,
  );
  error.is_retriable = false;
  error.details = {
    instagram_publish_stage: "prepublish_asset_integrity",
    instagram_outcome_uncertain: false,
    reason,
    asset_id: asset?._id ? String(asset._id) : null,
    asset_sequence: sequence,
    storage_provider: trimText(asset?.storage_provider || asset?.storageProvider).toLowerCase() || null,
    storage_key: trimText(asset?.storage_key || asset?.storageKey) || null,
    ...details,
  };
  return error;
}

async function verifyMandatoryBrandPublicationAssetIntegrity({
  draft = null,
  assets = [],
  dependencies = {},
} = {}) {
  if (draft?.brand_logo_contract?.required !== true) {
    return { required: false, status: "NOT_APPLICABLE", verified_assets: [] };
  }

  const publicationAssets = Array.isArray(assets) ? assets : [];
  if (!publicationAssets.length) {
    throw brandLogoAssetIntegrityError({}, "publication_assets_missing");
  }

  const resolveGeneratedAsset = dependencies.getGeneratedCampaignAssetReference
    || getGeneratedCampaignAssetReference;
  const hashAssetFile = dependencies.hashFileSha256 || sha256File;
  const verifiedAssets = [];

  for (const asset of publicationAssets) {
    const storageProvider = trimText(asset?.storage_provider || asset?.storageProvider).toLowerCase();
    const storageKey = trimText(asset?.storage_key || asset?.storageKey);
    const expectedChecksum = trimText(asset?.checksum_sha256 || asset?.checksumSha256).toLowerCase();
    if (storageProvider !== "local") {
      throw brandLogoAssetIntegrityError(asset, "storage_provider_unsupported");
    }
    if (!storageKey) {
      throw brandLogoAssetIntegrityError(asset, "storage_key_missing");
    }
    if (!/^[a-f0-9]{64}$/.test(expectedChecksum)) {
      throw brandLogoAssetIntegrityError(asset, "approved_checksum_missing_or_invalid");
    }

    let reference;
    try {
      reference = await resolveGeneratedAsset(storageKey);
    } catch (_error) {
      throw brandLogoAssetIntegrityError(asset, "storage_key_invalid");
    }
    if (!reference?.filePath) {
      throw brandLogoAssetIntegrityError(asset, "storage_key_not_generated_asset");
    }

    let actualChecksum;
    try {
      actualChecksum = trimText(await hashAssetFile(reference.filePath)).toLowerCase();
    } catch (_error) {
      throw brandLogoAssetIntegrityError(asset, "asset_missing_or_unreadable");
    }
    if (!/^[a-f0-9]{64}$/.test(actualChecksum)) {
      throw brandLogoAssetIntegrityError(asset, "computed_checksum_invalid");
    }
    if (!crypto.timingSafeEqual(Buffer.from(actualChecksum, "hex"), Buffer.from(expectedChecksum, "hex"))) {
      throw brandLogoAssetIntegrityError(asset, "checksum_mismatch", {
        expected_checksum_sha256: expectedChecksum,
        actual_checksum_sha256: actualChecksum,
      });
    }

    verifiedAssets.push({
      asset_id: asset?._id ? String(asset._id) : null,
      asset_sequence: Number(asset?.slide_number || asset?.slideNumber || 1),
      storage_provider: storageProvider,
      storage_key: reference.storageKey || storageKey,
      checksum_sha256: actualChecksum,
    });
  }

  return {
    required: true,
    status: "PASSED",
    verified_asset_count: verifiedAssets.length,
    verified_assets: verifiedAssets,
  };
}

function publicationModelContentType(format) {
  if (format === "CAROUSEL") return "CAROUSEL";
  if (format === "REEL") return "REEL";
  if (format === "VIDEO_FEED") return "VIDEO_FEED";
  if (format === "STORY") return "STORY";
  return "SINGLE_IMAGE";
}

function publicationLeaseActive(publication, now = new Date()) {
  const expiry = publication?.lease_expires_at ? new Date(publication.lease_expires_at) : null;
  return Boolean(publication?.lease_owner && expiry && Number.isFinite(expiry.getTime()) && expiry.getTime() > now.getTime());
}

function storySequenceCheckpointSafelyResumable(publication = {}) {
  if (String(publication.content_type || "").toUpperCase() !== "STORY") return false;
  const checkpoint = publication.provider_checkpoint || {};
  if (checkpoint.status !== "story_frame_published") return false;
  const frames = Array.isArray(checkpoint.story_frames) ? checkpoint.story_frames : [];
  const expectedCount = Array.isArray(publication.asset_urls) ? publication.asset_urls.length : 0;
  if (!expectedCount || frames.length !== expectedCount) return false;
  let pendingSeen = false;
  let publishedCount = 0;
  for (const frame of frames) {
    const mediaId = trimText(frame?.media_id);
    const creationId = trimText(frame?.creation_id);
    const status = trimText(frame?.status).toLowerCase();
    if (status === "publishing") return false;
    if (mediaId) {
      if (pendingSeen || !creationId || status !== "published") return false;
      publishedCount += 1;
    } else {
      pendingSeen = true;
    }
  }
  const checkpointMediaIds = Array.isArray(checkpoint.media_ids)
    ? checkpoint.media_ids.map(trimText).filter(Boolean)
    : [];
  return publishedCount > 0
    && publishedCount < expectedCount
    && checkpointMediaIds.length === publishedCount
    && new Set(checkpointMediaIds).size === checkpointMediaIds.length;
}

function buildInstagramCaption(recommendation = {}) {
  return buildSocialCaptionContract(recommendation).caption;
}

function activeAssets(assets = []) {
  return (Array.isArray(assets) ? assets : [])
    .filter((asset) => asset && asset.is_active !== false && !asset.deleted_at)
    .sort((left, right) => Number(left.slide_number || 1) - Number(right.slide_number || 1));
}

function assetReady(asset = {}) {
  if (asset.validation_status !== "valid" && asset.validation_status !== "needs_manual_review") return false;
  if (asset.manual_review_required === true && asset.manual_review_status !== "approved") return false;
  return asset.manual_review_status !== "rejected";
}

function requiredScopePresent(connection = {}) {
  return (Array.isArray(connection.granted_scopes) ? connection.granted_scopes : [])
    .some((scope) => REQUIRED_PUBLISH_SCOPE_NAMES.has(String(scope).trim()));
}

function buildReadiness({ draft, assets = [], settings = {}, connection = {}, now = new Date(), publishNow = false, existingPublication = null, affiliateProduct = null, audioTrack = null } = {}) {
  const blockers = [];
  const recommendation = draft?.current_package?.primaryRecommendation || {};
  const format = recommendation.format;
  const usableAssets = activeAssets(assets);
  const contentType = instagramContentType(format);
  const videoContent = ["reel", "video_feed"].includes(contentType);
  const videoAssets = usableAssets.filter((asset) => String(asset.mime_type || asset.mimeType || "").toLowerCase().startsWith("video/"));
  const imageAssets = usableAssets.filter((asset) => {
    const mimeType = String(asset.mime_type || asset.mimeType || "").toLowerCase();
    return !mimeType || mimeType.startsWith("image/");
  });
  const storyAssets = usableAssets.filter((asset) => {
    const mimeType = String(asset.mime_type || asset.mimeType || "").toLowerCase();
    return !mimeType || mimeType.startsWith("image/") || mimeType.startsWith("video/");
  });
  const publicationAssets = videoContent ? videoAssets : contentType === "story" ? storyAssets : imageAssets;
  const compliance = scanRecommendationCompliance(recommendation, { requireSourcesForCurrentClaims: true });
  const captionContract = buildSocialCaptionContract(recommendation, {
    requireAffiliateDisclosure: isAffiliateRecommendation(recommendation),
    requireFinancialDisclaimer: settings.approval?.require_disclosures === true,
  });
  const instagramCaption = captionContract.caption;
  const approvedCaptionChecksum = trimText(
    draft?.approval_json?.caption_checksum_sha256
      || draft?.caption_checksum_sha256,
  ).toLowerCase();

  if (!draft) blockers.push({ code: "draft_missing", message: "The social draft does not exist." });
  if (!publishingFeatureEnabled(settings)) blockers.push({ code: "publishing_disabled", message: "Instagram publishing is disabled by server and admin feature flags." });
  if (!settings.approval?.require_human_approval) blockers.push({ code: "approval_policy_invalid", message: "The human approval policy is not active." });
  if (!draft?.approved_at || !draft?.approved_by_admin_id || draft?.approved_revision !== draft?.revision) {
    blockers.push({ code: "approval_required", message: "The current draft revision has not been approved by an administrator." });
  }
  const safelyResumableStalePublication = draft?.status === "PUBLISHING"
    && existingPublication
    && (["VALIDATING", "CONTAINER_CREATED"].includes(existingPublication.status)
      || (existingPublication.status === "PUBLISHING" && storySequenceCheckpointSafelyResumable(existingPublication)))
    && !publicationLeaseActive(existingPublication, now);
  if (!["APPROVED", "SCHEDULED", "FAILED"].includes(draft?.status) && !safelyResumableStalePublication) {
    blockers.push({ code: "draft_status_invalid", message: `A ${draft?.status || "missing"} draft cannot be published.` });
  }
  if (!contentType) blockers.push({ code: "format_not_publishable", message: `${format || "This format"} is not supported by the installed Instagram publishing adapter.` });
  if (!compliance.passed) {
    blockers.push({ code: "compliance_failed", message: "The current recommendation fails server compliance checks.", details: compliance.risk_flags });
  }
  if (recommendation.contentPillar === "Curated Wellness and Affiliate Products") {
    const expectedLandingPage = affiliateProduct?.slug ? `/product/${encodeURIComponent(affiliateProduct.slug)}` : null;
    if (!affiliateProduct
      || trimText(recommendation.verifiedProductId) !== String(affiliateProduct._id)
      || trimText(recommendation.verifiedProductTitle) !== trimText(affiliateProduct.title)
      || recommendation.recommendedLandingPage !== expectedLandingPage) {
      blockers.push({ code: "affiliate_product_unverified", message: "Affiliate publication requires the same active, compliant, rights-cleared Pink Paisa product and landing page that were verified during generation." });
    }
  }
  if (contentType !== "story" && (!instagramCaption || instagramCaption.length > 2200)) {
    blockers.push({ code: "caption_length_invalid", message: "The complete Instagram caption, CTA, disclosures, and hashtags must fit within 2,200 characters." });
  }
  const nonLengthCaptionViolations = captionContract.violations.filter((violation) => violation !== "CAPTION_EXCEEDS_2200_CHARACTERS");
  if (contentType !== "story" && nonLengthCaptionViolations.length) {
    blockers.push({
      code: "caption_contract_invalid",
      message: "The Instagram caption must contain affiliate disclosure, caption, CTA, financial disclaimer, and hashtags exactly once in the approved order.",
      details: nonLengthCaptionViolations,
    });
  }
  if (contentType === "story" && captionContract.violations.length) {
    blockers.push({
      code: "story_frame_copy_invalid",
      message: "Stories publish without captions, so required affiliate disclosure, CTA, and general disclaimer copy must be present for first/final-frame rendering.",
      details: captionContract.violations,
    });
  }
  if (
    contentType !== "story"
    && approvedCaptionChecksum
    && approvedCaptionChecksum !== captionContract.checksum_sha256
  ) {
    blockers.push({
      code: "caption_approval_checksum_mismatch",
      message: "The publication caption has changed since the current revision was approved; review and approve it again before publishing.",
      details: {
        approved_checksum_sha256: approvedCaptionChecksum,
        current_checksum_sha256: captionContract.checksum_sha256,
      },
    });
  }
  if (contentType === "story" && publicationAssets.some((asset) => !storyOnFrameProvenancePassed(asset))) {
    blockers.push({
      code: "story_on_frame_copy_invalid",
      message: "Stories do not publish a caption; every Story asset must retain validated first-frame/final-frame on-image copy provenance.",
    });
  }
  try {
    if (recommendation.recommendedLandingPage) validateLandingPage(recommendation.recommendedLandingPage);
  } catch (error) {
    blockers.push({ code: "landing_page_invalid", message: error.message });
  }
  if (!publicationAssets.length) blockers.push({ code: "creative_missing", message: videoContent ? "A validated assembled video asset is required; a Reel cover or storyboard is not publishable video." : "At least one active creative asset is required." });
  if (contentType === "single_image" && publicationAssets.length !== 1) {
    blockers.push({ code: "asset_count_invalid", message: "A single-image post requires exactly one active asset." });
  }
  if (contentType === "carousel" && (publicationAssets.length < 2 || publicationAssets.length > 10)) {
    blockers.push({ code: "asset_count_invalid", message: "A carousel requires between two and ten active assets." });
  }
  if (["reel", "video_feed"].includes(contentType) && publicationAssets.length !== 1) {
    blockers.push({ code: "asset_count_invalid", message: `${format} publishing requires exactly one validated publication media asset.` });
  }
  if (contentType === "story" && (publicationAssets.length < 1 || publicationAssets.length > 10)) {
    blockers.push({ code: "asset_count_invalid", message: "A Story requires between one and ten ordered image or video frames." });
  }
  if (contentType === "story" && publicationAssets.length) {
    const expectedFrameCount = Number(recommendation?.formatContent?.frameCount)
      || (Array.isArray(recommendation?.formatContent?.frames) ? recommendation.formatContent.frames.length : 0)
      || (Array.isArray(recommendation?.onPostCopy?.storyFrames) ? recommendation.onPostCopy.storyFrames.length : 0);
    if (expectedFrameCount > 0 && publicationAssets.length !== expectedFrameCount) {
      blockers.push({
        code: "story_asset_count_mismatch",
        message: `The approved Story requires ${expectedFrameCount} ordered frame${expectedFrameCount === 1 ? "" : "s"}, but ${publicationAssets.length} publishable asset${publicationAssets.length === 1 ? " is" : "s are"} present.`,
      });
    }
    const sequences = publicationAssets.map((asset) => Number(asset.slide_number));
    if (sequences.some((sequence, index) => !Number.isInteger(sequence) || sequence !== index + 1)) {
      blockers.push({
        code: "story_asset_sequence_invalid",
        message: "Story assets must have a complete, unique 1..N frame sequence before publishing.",
      });
    }
  }
  if (["REEL", "VIDEO_FEED"].includes(format) && draft?.audio_track_id) {
    const selectedTrackId = String(draft.audio_track_id);
    if (!audioTrack
      || audioTrack.is_active === false
      || audioTrack.deactivated_at
      || audioTrack.rights_confirmed !== true
      || !["OWNED", "LICENSED", "PUBLIC_DOMAIN", "ADMIN_APPROVED"].includes(String(audioTrack.license_status || "").toUpperCase())) {
      blockers.push({ code: "reel_audio_rights_required", message: "The selected video audio track no longer has active, administrator-confirmed usage rights." });
    } else {
      const videoAudio = publicationAssets[0]?.provenance?.audio_rights || null;
      if (!videoAudio
        || String(videoAudio.track_id || "") !== selectedTrackId
        || String(videoAudio.checksum_sha256 || "").toLowerCase() !== String(audioTrack.checksum_sha256 || "").toLowerCase()
        || videoAudio.rights_confirmed !== true) {
        blockers.push({ code: "reel_audio_render_stale", message: "The assembled video does not contain the currently selected rights-confirmed audio track; rebuild and review it before publishing." });
      }
    }
  }
  if (contentType === "story" && settings.weekly_planning?.companion_stories_enabled !== true) {
    blockers.push({ code: "story_publishing_disabled", message: "Story publishing is disabled until companion Stories are separately enabled." });
  }
  if (publicationAssets.some((asset) => !assetReady(asset))) {
    blockers.push({ code: "creative_validation_pending", message: "Every active asset must pass automated validation and any required manual review." });
  }
  if (draft?.brand_logo_contract?.required
    && publicationAssets.some((asset) => !brandLogoPublicationEvidencePassed({ draft, asset, format }))) {
    blockers.push({
      code: "social_brand_logo_evidence_invalid",
      message: "Every image, slide, Story frame, and final video scene must retain passing evidence for the mandatory AI-baked Pink Paisa badge.",
    });
  }
  if (publicationAssets.some((asset) => !isPublicMediaUrl(asset.url))) {
    blockers.push({ code: "asset_url_not_public", message: "Instagram requires every creative to have a public HTTPS URL." });
  }
  if (!connection?.is_connected || connection?.status !== "connected") {
    blockers.push({ code: "instagram_not_connected", message: "Connect the intended Instagram professional account before publishing." });
  } else if (!requiredScopePresent(connection)) {
    blockers.push({ code: "instagram_permission_missing", message: "The connected account is missing an Instagram content publishing permission." });
  }
  const expectedAccountId = trimText(process.env.SOCIAL_MANAGER_INSTAGRAM_ACCOUNT_ID);
  if (expectedAccountId && trimText(connection?.instagram_user_id) !== expectedAccountId) {
    blockers.push({ code: "instagram_account_mismatch", message: "The connected Instagram account does not match SOCIAL_MANAGER_INSTAGRAM_ACCOUNT_ID." });
  }
  if (connection?.token_expires_at && new Date(connection.token_expires_at).getTime() <= now.getTime()) {
    blockers.push({ code: "instagram_token_expired", message: "The connected Instagram token has expired; reconnect the account." });
  }
  if (!publishNow && draft?.status === "SCHEDULED") {
    const scheduledFor = new Date(draft.scheduled_for || draft.schedule_json?.scheduled_for || 0);
    if (!Number.isFinite(scheduledFor.getTime())) blockers.push({ code: "schedule_invalid", message: "The scheduled publication time is invalid." });
    else if (scheduledFor.getTime() > now.getTime()) blockers.push({ code: "schedule_not_due", message: "The scheduled publication time has not arrived." });
  }
  if (existingPublication?.status === "PUBLISHED" || draft?.published_at || draft?.status === "PUBLISHED") {
    blockers.push({ code: "already_published", message: "This draft has already been published." });
  }
  if (existingPublication?.status === "UNCERTAIN") {
    blockers.push({ code: "publish_outcome_uncertain", message: "The prior Instagram outcome is uncertain. Reconcile it manually before taking any further publication action." });
  }
  if (PUBLICATION_IN_FLIGHT_STATUSES.has(existingPublication?.status) && publicationLeaseActive(existingPublication, now)) {
    blockers.push({ code: "publish_in_progress", message: "Another worker already owns this Instagram publication attempt." });
  }
  if (existingPublication?.status === "PUBLISHING"
    && !publicationLeaseActive(existingPublication, now)
    && !storySequenceCheckpointSafelyResumable(existingPublication)) {
    blockers.push({ code: "publish_outcome_uncertain", message: "A stale publication crossed the pre-publish checkpoint. Reconcile Instagram manually before retrying." });
  }
  if (existingPublication && Number(existingPublication.attempt_count || 0) >= Math.max(Number(existingPublication.max_attempts || 4), 1)) {
    blockers.push({ code: "publish_retry_limit_reached", message: "The publication retry limit has been reached. Duplicate the draft after resolving the provider issue." });
  }

  return {
    ready: blockers.length === 0,
    blockers,
    checked_at: now.toISOString(),
    feature_enabled: publishingFeatureEnabled(settings),
    auto_publish_enabled: autoPublishEnabled(settings),
    approval_valid: Boolean(draft?.approved_at && draft?.approved_revision === draft?.revision),
    compliance,
    connection: {
      id: connection?.id || null,
      is_connected: Boolean(connection?.is_connected),
      username: connection?.instagram_username || null,
      account_type: connection?.account_type || null,
      granted_scopes: connection?.granted_scopes || [],
    },
    content_type: contentType,
    caption_contract: captionContract,
    caption_checksum_sha256: contentType === "story" ? null : captionContract.checksum_sha256,
    approved_caption_checksum_sha256: contentType === "story" ? null : approvedCaptionChecksum || null,
    asset_count: publicationAssets.length,
    asset_urls: publicationAssets.map((asset) => asset.url),
    asset_mime_types: publicationAssets.map((asset) => asset.mime_type || asset.mimeType || null),
    asset_sequences: publicationAssets.map((asset) => Number(asset.slide_number || 1)),
  };
}

async function appendAudit({ action, actionStatus = "SUCCEEDED", summary, draft, publication = null, actorType = "WORKER", actorAdminId = null, metadata = null, error = null, models = {}, session = null }) {
  const AuditModel = models.SocialAuditLog || SocialAuditLog;
  return createWithSession(AuditModel, {
    entity_type: publication ? "PUBLICATION" : "DRAFT",
    entity_id: publication?._id || draft._id,
    generation_run_id: draft.generation_run_id,
    draft_id: draft._id,
    publication_id: publication?._id || null,
    action,
    action_status: actionStatus,
    actor_type: actorAdminId ? "ADMIN" : actorType,
    actor_admin_id: actorAdminId || null,
    actor_label: actorAdminId ? "Pink Paisa administrator" : "Social publishing worker",
    summary,
    error_code: error?.code || null,
    error_message: error?.message || null,
    metadata,
  }, session);
}

function normalizeMediaEnrichmentWarning(value) {
  if (!value || typeof value !== "object") return null;
  const providerStatus = Number(value.provider_status || 0) || null;
  const providerCode = value.provider_code == null
    ? null
    : String(value.provider_code).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
  return {
    code: "instagram_media_enrichment_failed",
    message: "Instagram published the media, but the follow-up media/permalink lookup failed. Do not republish; retry enrichment for the stored Meta media ID.",
    provider_status: providerStatus,
    provider_code: providerCode
      && !/(?:access|refresh)[_-]?token|secret|password|authorization|api[_-]?key/i.test(providerCode)
      ? providerCode
      : null,
    is_retriable: value.is_retriable !== false,
  };
}

async function persistPublishedMediaEnrichmentWarning({ warning, draft, publication, actorAdminId = null, publishedAt = new Date(), models = {} }) {
  if (!warning) return null;
  const ActionModel = models.SocialManualAction || SocialManualAction;
  const actionKey = `social-published-media-enrichment:${publication._id}:${publication.external_publication_id}`.slice(0, 400);
  const actionRecord = {
    action_key: actionKey,
    action_type: "PUBLISH_RECONCILIATION",
    status: "OPEN",
    priority: "MEDIUM",
    title: "Retrieve the published Instagram permalink and media details",
    description: "Instagram returned a real published media ID, so the post remains PUBLISHED. The follow-up media lookup failed and its permalink/details still require enrichment.",
    instructions: [
      "Do not publish this draft again; use the stored Meta media ID to retry the media-details lookup.",
      "Confirm the post in Instagram, save its permalink/details to the existing publication, and then complete this action with the reconciliation outcome.",
    ],
    provider: "INSTAGRAM",
    weekly_plan_id: draft.weekly_plan_id || null,
    generation_run_id: draft.generation_run_id || null,
    draft_id: draft._id,
    publication_id: publication._id,
    external_reference_id: publication.external_publication_id,
    due_at: new Date(publishedAt.getTime() + 24 * 60 * 60 * 1000),
    assigned_to_admin_id: actorAdminId || null,
    created_by_admin_id: actorAdminId || null,
  };
  let action = null;
  try {
    action = typeof ActionModel.findOneAndUpdate === "function"
      ? await ActionModel.findOneAndUpdate(
        { action_key: actionKey },
        { $setOnInsert: actionRecord },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
      )
      : await ActionModel.create(actionRecord);
    const actionId = action?._id || action?.id;
    if (actionId) {
      draft.manual_action_ids = [...new Map([...(draft.manual_action_ids || []), actionId].map((id) => [String(id), id])).values()];
      draft.publication_json = {
        ...(draft.publication_json || {}),
        media_enrichment_manual_action_id: actionId,
      };
      await draft.save();
    }
  } catch (error) {
    logger.error({ err: error, publicationId: String(publication._id || "") }, "Published Instagram media enrichment manual action could not be persisted");
  }

  const warningError = new Error(warning.message);
  warningError.code = warning.code;
  try {
    await appendAudit({
      action: "PUBLISHED_MEDIA_ENRICHMENT_FAILED",
      actionStatus: "FAILED",
      summary: "Instagram published successfully with a real media ID, but permalink/media enrichment failed and requires follow-up without republishing.",
      draft,
      publication,
      actorAdminId,
      metadata: {
        external_publication_id: publication.external_publication_id,
        manual_action_id: action?._id || action?.id || null,
        provider_status: warning.provider_status,
        provider_code: warning.provider_code,
        is_retriable: warning.is_retriable,
      },
      error: warningError,
      models,
    });
  } catch (error) {
    logger.error({ err: error, publicationId: String(publication._id || "") }, "Published Instagram media enrichment audit could not be persisted");
  }
  return action;
}

async function persistPublicationUncertainManualAction({
  draft = null,
  publication,
  actorAdminId = null,
  occurredAt = new Date(),
  error = null,
  models = {},
  session = null,
}) {
  const ActionModel = models.SocialManualAction || SocialManualAction;
  const publicationId = publication?._id || publication?.id;
  if (!publicationId) throw new Error("An uncertain publication requires a durable publication identifier");
  const actionKey = `social-publish-reconciliation:${publicationId}:outcome-uncertain`.slice(0, 400);
  const checkpoint = publication?.provider_checkpoint || {};
  const externalReferenceId = checkpoint.media_id
    || checkpoint.media_ids?.[0]
    || checkpoint.creation_id
    || publication?.creation_id
    || String(publicationId);
  const actionRecord = {
    action_key: actionKey,
    action_type: "PUBLISH_RECONCILIATION",
    status: "OPEN",
    priority: "CRITICAL",
    title: "Reconcile an uncertain Instagram publication",
    description: `Instagram may have accepted publication ${publicationId}, but no authoritative Meta media identifier was confirmed. Automatic republishing is blocked.`.slice(0, 4000),
    instructions: [
      "Do not publish this draft again while the outcome remains uncertain.",
      "Inspect Instagram and provider logs using the stored creation/checkpoint identifiers.",
      "If the post exists, record its authoritative Meta media ID and permalink on the existing publication. If it cannot be confirmed, leave this action open and escalate for provider investigation.",
    ],
    provider: "INSTAGRAM",
    weekly_plan_id: draft?.weekly_plan_id || null,
    generation_run_id: draft?.generation_run_id || null,
    draft_id: draft?._id || null,
    publication_id: publicationId,
    external_reference_id: String(externalReferenceId).slice(0, 400),
    due_at: occurredAt,
    assigned_to_admin_id: actorAdminId || null,
    created_by_admin_id: actorAdminId || null,
  };
  const action = typeof ActionModel.findOneAndUpdate === "function"
    ? await ActionModel.findOneAndUpdate(
      { action_key: actionKey },
      { $setOnInsert: actionRecord },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true, ...(session ? { session } : {}) },
    )
    : await createWithSession(ActionModel, actionRecord, session);
  const actionId = action?._id || action?.id;
  if (draft && actionId) {
    draft.manual_action_ids = [...new Map([...(draft.manual_action_ids || []), actionId].map((id) => [String(id), id])).values()];
    draft.publication_json = {
      ...(draft.publication_json || {}),
      ...(publication?.status === "UNCERTAIN" ? { outcome_uncertain: true } : {}),
      reconciliation_manual_action_id: actionId,
    };
    await draft.save(session ? { session } : undefined);
  }
  if (error && actionId) error.manual_action_id = actionId;
  return action;
}

function normalizeAuthoritativePublicationId(value, publication) {
  const mediaId = trimText(value).slice(0, 301);
  if (!mediaId) {
    throw publishingError(
      "A confirmed Meta media identifier is required",
      "social_publication_external_id_required",
      400,
    );
  }
  if (mediaId.length > 300 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(mediaId)) {
    throw publishingError(
      "The Meta media identifier is invalid",
      "social_publication_external_id_invalid",
      422,
    );
  }
  const checkpoint = publication?.provider_checkpoint || {};
  const containerIds = [
    publication?.creation_id,
    ...(publication?.child_creation_ids || []),
    checkpoint.creation_id,
    checkpoint.container_id,
    ...(checkpoint.creation_ids || []),
    ...(checkpoint.child_creation_ids || []),
    ...(checkpoint.container_ids || []),
    ...(checkpoint.story_frames || []).map((frame) => frame?.creation_id),
  ].map((identifier) => trimText(identifier)).filter(Boolean);
  if (containerIds.includes(mediaId)) {
    throw publishingError(
      "A Meta container or creation identifier is not authoritative confirmation of a published media item",
      "social_publication_external_id_not_authoritative",
      422,
    );
  }
  return mediaId;
}

function normalizeInstagramPermalink(value) {
  const raw = trimText(value);
  if (!raw) return null;
  if (raw.length > 2048) {
    throw publishingError("The Instagram permalink is too long", "social_publication_permalink_invalid", 422);
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw publishingError("The Instagram permalink is invalid", "social_publication_permalink_invalid", 422);
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (parsed.protocol !== "https:" || hostname !== "instagram.com" || parsed.username || parsed.password) {
    throw publishingError(
      "The permalink must be an HTTPS Instagram URL",
      "social_publication_permalink_invalid",
      422,
    );
  }
  parsed.hash = "";
  return parsed.toString();
}

function publicPublicationReconciliation({ publication, draft, action, reused }) {
  return {
    reused: Boolean(reused),
    publication: {
      id: String(publication?._id || publication?.id || ""),
      draft_id: publication?.draft_id ? String(publication.draft_id) : null,
      status: publication?.status || null,
      provider: publication?.provider || null,
      external_publication_id: publication?.external_publication_id || null,
      external_permalink: publication?.external_permalink || null,
      published_at: publication?.published_at || null,
      draft_reconciled_at: publication?.draft_reconciled_at || null,
    },
    draft: draft ? {
      id: String(draft._id || draft.id || ""),
      status: draft.status || null,
      weekly_plan_id: draft.weekly_plan_id ? String(draft.weekly_plan_id) : null,
      candidate_id: draft.candidate_id || null,
      publication_id: draft.publication_id ? String(draft.publication_id) : null,
      published_at: draft.published_at || null,
    } : null,
    reconciliation: {
      manual_action_id: action?._id || action?.id ? String(action._id || action.id) : null,
      manual_action_status: action?.status || null,
      completion_source: action?.completion_source || null,
      resolution_evidence: action?.resolution_evidence || null,
    },
  };
}

async function reconcileUncertainPublication(publicationId, {
  actor,
  externalPublicationId,
  externalPermalink = null,
  notes,
  now = new Date(),
  dependencies = {},
} = {}) {
  const adminId = actorId(actor);
  if (!adminId) throw publishingError("An authenticated administrator is required", "social_admin_required", 401);
  const reconciliationNotes = trimText(notes);
  if (!reconciliationNotes) {
    throw publishingError("Reconciliation notes are required", "social_publication_reconciliation_notes_required", 400);
  }
  if (reconciliationNotes.length > 2000) {
    throw publishingError("Reconciliation notes must be 2,000 characters or fewer", "social_publication_reconciliation_notes_too_long", 422);
  }
  const permalink = normalizeInstagramPermalink(externalPermalink);
  const models = {
    SocialAuditLog: dependencies.SocialAuditLog || SocialAuditLog,
    SocialManualAction: dependencies.SocialManualAction || SocialManualAction,
    SocialPostDraft: dependencies.SocialPostDraft || SocialPostDraft,
    SocialPublication: dependencies.SocialPublication || SocialPublication,
  };

  return runPublishingTransaction(dependencies, async (session) => {
    const publication = await applyMongoSession(models.SocialPublication.findById(publicationId), session);
    if (!publication) throw publishingError("Social publication not found", "social_publication_not_found", 404);
    const authoritativeMediaId = normalizeAuthoritativePublicationId(externalPublicationId, publication);
    if (publication.provider !== "INSTAGRAM_GRAPH") {
      throw publishingError(
        "Only an Instagram Graph publication can be reconciled with a Meta media identifier",
        "social_publication_provider_invalid",
        409,
      );
    }
    if (!["UNCERTAIN", "PUBLISHED"].includes(publication.status)) {
      throw publishingError(
        `A publication in ${publication.status} cannot be reconciled`,
        "social_publication_not_uncertain",
        409,
      );
    }
    if (publication.external_publication_id
      && publication.external_publication_id !== authoritativeMediaId) {
      throw publishingError(
        "This publication already records a different Meta media identifier",
        "social_publication_reconciliation_conflict",
        409,
      );
    }
    if (permalink && publication.external_permalink && publication.external_permalink !== permalink) {
      throw publishingError(
        "This publication already records a different Instagram permalink",
        "social_publication_reconciliation_conflict",
        409,
      );
    }
    if (typeof models.SocialPublication.findOne === "function") {
      const duplicate = await applyMongoSession(models.SocialPublication.findOne({
        _id: { $ne: publication._id },
        external_publication_id: authoritativeMediaId,
      }), session);
      if (duplicate) {
        throw publishingError(
          "The supplied Meta media identifier is already linked to another publication",
          "social_publication_reconciliation_conflict",
          409,
        );
      }
    }
    const draft = await applyMongoSession(models.SocialPostDraft.findById(publication.draft_id), session);
    if (!draft) {
      throw publishingError(
        "The publication's linked draft no longer exists",
        "social_publication_draft_missing",
        409,
      );
    }
    if (draft.publication_id && String(draft.publication_id) !== String(publication._id)) {
      throw publishingError(
        "The linked draft references a different publication",
        "social_publication_reconciliation_conflict",
        409,
      );
    }

    const actionKey = `social-publish-reconciliation:${publication._id}:outcome-uncertain`.slice(0, 400);
    const samePublishedIdentity = publication.status === "PUBLISHED"
      && publication.external_publication_id === authoritativeMediaId
      && (!permalink || publication.external_permalink === permalink);
    let action = typeof models.SocialManualAction.findOne === "function"
      ? await applyMongoSession(models.SocialManualAction.findOne({ action_key: actionKey }), session)
      : null;
    const actionAlreadyResolved = action?.status === "COMPLETED"
      && action?.resolution_evidence?.resolver === "PUBLICATION"
      && String(action?.resolution_evidence?.provider_reference_id || "") === authoritativeMediaId;
    if (samePublishedIdentity && draft.status === "PUBLISHED" && actionAlreadyResolved) {
      return publicPublicationReconciliation({ publication, draft, action, reused: true });
    }
    if (publication.status === "PUBLISHED" && !samePublishedIdentity) {
      throw publishingError(
        "This publication is already reconciled with different provider details",
        "social_publication_reconciliation_conflict",
        409,
      );
    }
    if (!action) {
      action = await persistPublicationUncertainManualAction({
        draft,
        publication,
        actorAdminId: adminId,
        occurredAt: now,
        models,
        session,
      });
    }
    const actionId = action?._id || action?.id;
    if (publication.status === "UNCERTAIN" && action?.status === "COMPLETED") {
      throw publishingError(
        "The reconciliation action is already terminal while the publication remains uncertain",
        "social_publication_reconciliation_action_conflict",
        409,
      );
    }

    const completedAction = await models.SocialManualAction.findOneAndUpdate(
      {
        action_key: actionKey,
        action_type: "PUBLISH_RECONCILIATION",
        publication_id: publication._id,
        status: { $in: ["OPEN", "IN_PROGRESS"] },
      },
      {
        $set: {
          status: "COMPLETED",
          started_at: action?.started_at || now,
          completed_at: now,
          completed_by_admin_id: adminId,
          completion_source: "ADMIN",
          resolution_note: reconciliationNotes.slice(0, 4000),
          resolution_evidence: {
            resolver: "PUBLICATION",
            entity_type: "PUBLICATION",
            entity_id: String(publication._id),
            observed_status: "PUBLISHED",
            provider_reference_id: authoritativeMediaId,
            observed_at: now,
          },
        },
      },
      { new: true, runValidators: true, ...(session ? { session } : {}) },
    );
    if (!completedAction) {
      throw publishingError(
        "The linked publication reconciliation action could not be completed",
        "social_publication_reconciliation_action_conflict",
        409,
      );
    }

    const publishedAt = publication.published_at || now;
    publication.status = "PUBLISHED";
    publication.external_publication_id = authoritativeMediaId;
    publication.external_permalink = permalink || publication.external_permalink || null;
    publication.published_at = publishedAt;
    publication.finished_at = publication.finished_at || now;
    publication.draft_reconciled_at = now;
    publication.next_retry_at = null;
    publication.lease_owner = null;
    publication.lease_expires_at = null;
    publication.heartbeat_at = now;
    publication.last_error = null;
    publication.provider_checkpoint = {
      ...(publication.provider_checkpoint || {}),
      status: "published",
      media_id: authoritativeMediaId,
      ...(publication.external_permalink ? { permalink: publication.external_permalink } : {}),
    };
    publication.provider_response_metadata = {
      ...(publication.provider_response_metadata || {}),
      reconciliation: {
        source: "ADMIN_AUTHORITATIVE_META_ID",
        reconciled_at: now,
        reconciled_by_admin_id: adminId,
        provider_call_made: false,
      },
    };
    await publication.save(session ? { session } : undefined);

    draft.status = "PUBLISHED";
    draft.publication_id = publication._id;
    draft.published_at = publishedAt;
    draft.failed_at = null;
    draft.last_error = null;
    if (actionId) {
      draft.manual_action_ids = [...new Map([...(draft.manual_action_ids || []), actionId]
        .map((identifier) => [String(identifier), identifier])).values()];
    }
    draft.publication_json = {
      ...(draft.publication_json || {}),
      status: "PUBLISHED",
      external_publication_id: authoritativeMediaId,
      external_permalink: publication.external_permalink,
      published_at: publishedAt,
      outcome_uncertain: false,
      reconciled_from_admin_confirmation: true,
      reconciliation_manual_action_id: actionId || null,
    };
    await draft.save(session ? { session } : undefined);
    await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, {
      status: "PUBLISHED",
      publicationId: publication._id,
      dependencies: { ...dependencies, mongoSession: session },
    });

    await appendAudit({
      action: "PUBLISH_OUTCOME_RECONCILED",
      summary: "An administrator confirmed the existing Instagram publication using an authoritative Meta media identifier; no provider publish call was made.",
      draft,
      publication,
      actorAdminId: adminId,
      metadata: {
        external_publication_id: authoritativeMediaId,
        external_permalink: publication.external_permalink,
        manual_action_id: actionId || null,
        reconciliation_notes: reconciliationNotes,
        provider_call_made: false,
      },
      models,
      session,
    });
    await createWithSession(models.SocialAuditLog, {
      idempotency_key: `social-publication-reconciliation-action-completed:${actionId}`,
      entity_type: "MANUAL_ACTION",
      entity_id: actionId,
      generation_run_id: draft.generation_run_id || null,
      draft_id: draft._id,
      publication_id: publication._id,
      action: "MANUAL_ACTION_COMPLETED",
      action_status: "SUCCEEDED",
      actor_type: "ADMIN",
      actor_admin_id: adminId,
      actor_label: "Pink Paisa administrator",
      summary: "The dedicated publication reconciliation completed the linked manual action using an authoritative Meta media identifier.",
      field_changes: [{ field_path: "status", before: action?.status || "OPEN", after: "COMPLETED", is_redacted: false }],
      metadata: {
        completion_source: "ADMIN",
        resolution_evidence: completedAction.resolution_evidence,
        provider_call_made: false,
      },
    }, session);
    return publicPublicationReconciliation({ publication, draft, action: completedAction, reused: false });
  });
}

function retryDelayMs(publication, settings = {}) {
  const baseSeconds = Math.max(Number(settings.publishing?.retry_base_delay_seconds || 30), 5);
  return Math.min(baseSeconds * (2 ** Math.max(Number(publication.retry_count || 0), 0)) * 1000, 6 * 60 * 60 * 1000);
}

function isRetriablePublishError(error) {
  if (error?.is_retriable === false) return false;
  const status = Number(error?.response?.status || error?.status || 0);
  return !error?.details?.instagram_outcome_uncertain && (!status || [408, 409, 425, 429, 500, 502, 503, 504].includes(status));
}

async function loadPublishingContext({ draftId, dependencies = {} }) {
  const models = {
    Product: dependencies.Product || Product,
    SocialAsset: dependencies.SocialAsset || SocialAsset,
    SocialAudioTrack: dependencies.SocialAudioTrack || SocialAudioTrack,
    SocialAuditLog: dependencies.SocialAuditLog || SocialAuditLog,
    SocialManualAction: dependencies.SocialManualAction || SocialManualAction,
    SocialPostDraft: dependencies.SocialPostDraft || SocialPostDraft,
    SocialPublication: dependencies.SocialPublication || SocialPublication,
  };
  const draft = await models.SocialPostDraft.findById(draftId);
  if (!draft) {
    const error = new Error("Social draft not found");
    error.statusCode = 404;
    throw error;
  }
  const recommendation = draft.current_package?.primaryRecommendation || {};
  const affiliateProductPromise = recommendation.contentPillar === "Curated Wellness and Affiliate Products"
    ? models.Product.findOne({
      _id: recommendation.verifiedProductId,
      title: recommendation.verifiedProductTitle,
      status: "active",
      is_visible: true,
      archived_at: null,
      is_affiliate: true,
      affiliate_compliance_status: "compliant",
      affiliate_url: { $nin: [null, ""] },
      affiliate_campaign_usage_rights: { $in: ["admin_confirmed", "owned", "licensed", "api_permitted"] },
    }).select("_id title slug").lean().catch(() => null)
    : Promise.resolve(null);
  const [assets, connection, existingPublication, affiliateProduct, audioTrack] = await Promise.all([
    models.SocialAsset.find({ _id: { $in: draft.asset_ids || [] }, is_active: true, deleted_at: null }).sort({ slide_number: 1 }),
    (dependencies.getInstagramConnectionSummary || getInstagramConnectionSummary)(),
    models.SocialPublication.findOne({ draft_id: draft._id }),
    affiliateProductPromise,
    draft.audio_track_id ? models.SocialAudioTrack.findById(draft.audio_track_id) : null,
  ]);
  return { models, draft, assets, connection, existingPublication, affiliateProduct, audioTrack, dependencies };
}

async function ensurePublicationRecord({ context, settings, actorAdminId = null, publishNow = true, now = new Date() }) {
  const { models, draft, assets, connection, affiliateProduct, audioTrack } = context;
  let { existingPublication } = context;
  const readiness = buildReadiness({ draft, assets, settings, connection, now, publishNow, existingPublication, affiliateProduct, audioTrack });
  if (!readiness.ready) {
    const error = new Error(readiness.blockers.map((blocker) => blocker.message).join(" "));
    error.code = readiness.blockers[0]?.code || "social_publish_not_ready";
    error.statusCode = 409;
    error.readiness = readiness;
    let manualAction = null;
    if (!publishNow && draft.status === "SCHEDULED") {
      const actionKey = `social-scheduled-readiness:${draft._id}:r${draft.revision || 1}`;
      const blockerSummary = readiness.blockers.map((blocker) => `${blocker.code}: ${blocker.message}`).join(" | ");
      const actionRecord = {
        action_key: actionKey,
        action_type: "PUBLISH_RECONCILIATION",
        status: "OPEN",
        priority: "HIGH",
        title: "Resolve a blocked scheduled Instagram publication",
        description: `The scheduled post reached its publication time but failed readiness checks: ${blockerSummary}`.slice(0, 4000),
        instructions: [
          "Open the linked draft, resolve every readiness blocker, re-run fact and media checks, obtain approval for the current revision, and schedule it again.",
          "Do not mark this task complete until the draft is safely rescheduled or deliberately cancelled.",
        ],
        provider: "INSTAGRAM",
        weekly_plan_id: draft.weekly_plan_id || null,
        generation_run_id: draft.generation_run_id || null,
        draft_id: draft._id,
        due_at: draft.scheduled_for || now,
        assigned_to_admin_id: actorAdminId || null,
        created_by_admin_id: actorAdminId || null,
      };
      manualAction = typeof models.SocialManualAction.findOneAndUpdate === "function"
        ? await models.SocialManualAction.findOneAndUpdate(
          { action_key: actionKey },
          { $setOnInsert: actionRecord },
          { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
        )
        : await models.SocialManualAction.create(actionRecord);
      const actionId = manualAction?._id || manualAction?.id;
      if (actionId) {
        draft.manual_action_ids = [...new Map([...(draft.manual_action_ids || []), actionId].map((id) => [String(id), id])).values()];
      }
      draft.status = "FAILED";
      draft.failed_at = now;
      draft.last_error = {
        code: error.code,
        message: trimText(error.message).slice(0, 4000),
        stage: "PUBLISHING_READINESS",
        is_retriable: false,
        occurred_at: now,
      };
      draft.publication_json = {
        status: "BLOCKED",
        blocker_codes: readiness.blockers.map((blocker) => blocker.code),
        manual_action_id: actionId || null,
      };
      await draft.save();
      await (context.dependencies?.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, {
        status: "FAILED",
        dependencies: context.dependencies || {},
      });
      error.manual_action_id = actionId || null;
    }
    await appendAudit({
      action: "PUBLISH_BLOCKED",
      actionStatus: "FAILED",
      summary: "Instagram publication was blocked by readiness checks.",
      draft,
      publication: existingPublication,
      actorAdminId,
      metadata: {
        blocker_codes: readiness.blockers.map((blocker) => blocker.code),
        manual_action_id: manualAction?._id || manualAction?.id || null,
        scheduled_failure_persisted: Boolean(manualAction),
      },
      error,
      models,
    });
    throw error;
  }

  const recommendation = draft.current_package.primaryRecommendation;
  const usableAssets = activeAssets(assets).filter((asset) => readiness.asset_urls.includes(asset.url));
  const captionContract = readiness.caption_contract || buildSocialCaptionContract(recommendation, {
    requireAffiliateDisclosure: isAffiliateRecommendation(recommendation),
    requireFinancialDisclaimer: settings.approval?.require_disclosures === true,
  });
  const caption = captionContract.caption;
  const assetUrls = [...readiness.asset_urls];
  const payloadFingerprint = buildPublicationFingerprint({ recommendation: { ...recommendation, caption }, assetUrls });
  const assetFingerprint = sha256(assetUrls.join("\n"));
  const idempotencyKey = `social-publish:${draft._id}:${draft.revision}:${payloadFingerprint}`;
  let publication = existingPublication;
  if (publication && publication.payload_fingerprint !== payloadFingerprint) {
    const error = new Error("The approved draft payload no longer matches its existing publication attempt");
    error.code = "publication_payload_changed";
    error.statusCode = 409;
    throw error;
  }
  if (!publication) {
    const retryLimit = Math.min(Math.max(Number(settings.publishing?.retry_limit ?? 3), 0), 10);
    try {
      publication = await models.SocialPublication.create({
        draft_id: draft._id,
        generation_run_id: draft.generation_run_id,
        idempotency_key: idempotencyKey,
        provider: "INSTAGRAM_GRAPH",
        instagram_connection_id: connection.id || null,
        approved_revision: draft.revision,
        status: "QUEUED",
        content_type: publicationModelContentType(recommendation.format),
        asset_ids: usableAssets.map((asset) => asset._id),
        asset_urls: assetUrls,
        caption_hash: captionContract.checksum_sha256,
        asset_fingerprint: assetFingerprint,
        payload_fingerprint: payloadFingerprint,
        readiness_snapshot: readiness,
        queued_at: now,
        scheduled_for: draft.scheduled_for || null,
        max_attempts: retryLimit + 1,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      publication = await models.SocialPublication.findOne({ draft_id: draft._id });
      if (!publication || publication.payload_fingerprint !== payloadFingerprint) {
        const conflict = new Error("A conflicting Instagram publication intent already exists for this draft");
        conflict.code = "publication_intent_conflict";
        conflict.statusCode = 409;
        throw conflict;
      }
    }
  }
  return { publication, readiness, recommendation, usableAssets, caption, captionContract, assetUrls, payloadFingerprint, idempotencyKey };
}

async function getSocialPublishingReadiness({ draftId, settings, publishNow = true, now = new Date(), dependencies = {} } = {}) {
  const context = await loadPublishingContext({ draftId, dependencies });
  return buildReadiness({
    draft: context.draft,
    assets: context.assets,
    settings,
    connection: context.connection,
    now,
    publishNow,
    existingPublication: context.existingPublication,
    affiliateProduct: context.affiliateProduct,
    audioTrack: context.audioTrack,
  });
}

async function queueSocialPublication({ draftId, settings, actorAdminId = null, now = new Date(), dependencies = {} } = {}) {
  const context = await loadPublishingContext({ draftId, dependencies });
  const ensured = await ensurePublicationRecord({ context, settings, actorAdminId, publishNow: true, now });
  const { draft, models } = context;
  const { publication } = ensured;
  if (publication.status === "FAILED") {
    publication.next_retry_at = now;
    publication.queued_at = now;
    await publication.save();
  } else if ((["VALIDATING", "CONTAINER_CREATED"].includes(publication.status)
    || (publication.status === "PUBLISHING" && storySequenceCheckpointSafelyResumable(publication)))
    && !publicationLeaseActive(publication, now)) {
    publication.status = "FAILED";
    publication.next_retry_at = now;
    publication.lease_owner = null;
    publication.lease_expires_at = null;
    publication.queued_at = now;
    await publication.save();
  }
  draft.publication_id = publication._id;
  draft.publication_json = {
    status: publication.status,
    queued_at: now,
    attempt_count: publication.attempt_count,
  };
  if (draft.status === "PUBLISHING") draft.status = "FAILED";
  await draft.save();
  await appendAudit({
    action: "PUBLISH_QUEUED",
    summary: "An administrator queued the approved draft for durable Instagram publication.",
    draft,
    publication,
    actorAdminId,
    metadata: {
      idempotency_key: ensured.idempotencyKey,
      payload_fingerprint: ensured.payloadFingerprint,
      caption_checksum_sha256: ensured.captionContract?.checksum_sha256 || null,
      caption_policy: ensured.captionContract?.policy || null,
    },
    models,
  });
  return { draft, publication };
}

async function publishSocialDraft({ draftId, settings, actorAdminId = null, publishNow = true, now = new Date(), dependencies = {} } = {}) {
  const context = await loadPublishingContext({ draftId, dependencies });
  const format = context.draft?.current_package?.primaryRecommendation?.format
    || context.draft?.result_json?.primaryRecommendation?.format
    || null;
  if (format !== "STORY") {
    await (dependencies.assertWeeklyPublicationCapacity || assertWeeklyPublicationCapacity)({
      at: context.draft?.scheduled_for || now,
      draftId: context.draft?._id,
      settings,
      dependencies: { ...dependencies, SocialPostDraft: context.models.SocialPostDraft },
    });
  }
  const ensured = await ensurePublicationRecord({ context, settings, actorAdminId, publishNow, now });
  const { models, draft } = context;
  const { readiness, caption, usableAssets, assetUrls, payloadFingerprint, idempotencyKey } = ensured;
  let { publication } = ensured;
  if (publication.status === "PUBLISHED") {
    const publishedStoryIds = Array.isArray(publication.external_publication_ids)
      ? publication.external_publication_ids.map(trimText).filter(Boolean)
      : [];
    const completePublishedStory = readiness.content_type !== "story"
      || (publishedStoryIds.length === assetUrls.length
        && publishedStoryIds[0] === trimText(publication.external_publication_id));
    if (!trimText(publication.external_publication_id) || !completePublishedStory) {
      const error = new Error("The stored publication is marked PUBLISHED without Meta's media identifier");
      error.code = "published_identity_missing";
      error.statusCode = 409;
      throw error;
    }
    return publication;
  }
  const maxAttempts = Math.max(Number(publication.max_attempts || 4), 1);

  publication = await models.SocialPublication.findOneAndUpdate(
    {
      _id: publication._id,
      status: { $in: ["QUEUED", "FAILED", "VALIDATING", "CONTAINER_CREATED"] },
      attempt_count: { $lt: maxAttempts },
      $or: [
        { lease_owner: null },
        { lease_expires_at: null },
        { lease_expires_at: { $lte: now } },
      ],
    },
    {
      $set: {
        status: "VALIDATING",
        lease_owner: PUBLICATION_WORKER_OWNER,
        lease_expires_at: new Date(now.getTime() + PUBLICATION_LEASE_MS),
        heartbeat_at: now,
        last_attempted_at: now,
        started_at: publication.started_at || now,
        next_retry_at: null,
        last_error: null,
      },
      $inc: { attempt_count: 1 },
    },
    { new: true },
  );
  if (!publication) {
    const current = await models.SocialPublication.findOne({ draft_id: draft._id });
    const retryLimitReached = Number(current?.attempt_count || 0) >= Math.max(Number(current?.max_attempts || 4), 1);
    const error = new Error(retryLimitReached
      ? "The Instagram publication retry limit has been reached"
      : "Another worker already owns this Instagram publication attempt");
    error.code = retryLimitReached ? "publish_retry_limit_reached" : "publish_in_progress";
    error.statusCode = 409;
    throw error;
  }
  draft.status = "PUBLISHING";
  draft.publishing_started_at = now;
  draft.publication_id = publication._id;
  draft.publication_json = { status: publication.status, attempt_count: publication.attempt_count };
  await draft.save();
  await appendAudit({
    action: "PUBLISH_STARTED",
    summary: `Instagram publication attempt ${publication.attempt_count} started.`,
    draft,
    publication,
    actorAdminId,
    metadata: { idempotency_key: idempotencyKey, payload_fingerprint: payloadFingerprint, lease_owner: PUBLICATION_WORKER_OWNER },
    models,
  });

  try {
    const prepublishAssetIntegrity = await (
      dependencies.verifyMandatoryBrandPublicationAssetIntegrity
      || verifyMandatoryBrandPublicationAssetIntegrity
    )({
      draft,
      assets: usableAssets,
      dependencies,
    });
    const result = await (dependencies.publishInstagramDraft || publishInstagramDraft)({
      contentType: readiness.content_type,
      assetUrls,
      assetMimeTypes: readiness.asset_mime_types,
      caption,
      resumeState: publication.provider_checkpoint || {
        creation_id: publication.creation_id,
        child_creation_ids: publication.child_creation_ids,
        media_id: publication.external_publication_id,
        media_ids: publication.external_publication_ids || [],
        permalink: publication.external_permalink,
        permalinks: publication.external_permalinks || [],
      },
      onProgress: async (checkpoint = {}) => {
        const statusMap = {
          container_created: "CONTAINER_CREATED",
          publishing: "PUBLISHING",
          published: "PUBLISHED",
        };
        publication.status = statusMap[checkpoint.status] || publication.status;
        publication.creation_id = checkpoint.creation_id || publication.creation_id;
        publication.child_creation_ids = checkpoint.child_creation_ids || publication.child_creation_ids;
        publication.external_publication_id = checkpoint.media_id || publication.external_publication_id;
        if (Array.isArray(checkpoint.media_ids)) {
          publication.external_publication_ids = checkpoint.media_ids;
        }
        publication.external_permalink = checkpoint.permalink || publication.external_permalink;
        if (Array.isArray(checkpoint.permalinks)) {
          publication.external_permalinks = checkpoint.permalinks.filter(Boolean);
        }
        if (checkpoint.status === "published" && checkpoint.media_id) {
          publication.published_at = publication.published_at || new Date();
          publication.finished_at = publication.finished_at || publication.published_at;
        }
        publication.provider_checkpoint = checkpoint;
        publication.heartbeat_at = new Date();
        publication.lease_expires_at = new Date(Date.now() + PUBLICATION_LEASE_MS);
        await publication.save();
      },
    });
    const resultCreationIds = [
      result?.creation_id,
      ...(Array.isArray(result?.creation_ids) ? result.creation_ids : []),
      ...(Array.isArray(result?.child_creation_ids) ? result.child_creation_ids : []),
    ].map(trimText).filter(Boolean);
    const rawPublishedMediaIds = readiness.content_type === "story"
      ? (Array.isArray(result?.media_ids) ? result.media_ids : [])
      : [result?.media_id];
    const trimmedPublishedMediaIds = rawPublishedMediaIds.map(trimText).filter(Boolean);
    const rawStoryMediaComplete = readiness.content_type !== "story"
      || trimmedPublishedMediaIds.length === assetUrls.length;
    const rawMediaIdsUnique = new Set(trimmedPublishedMediaIds).size === trimmedPublishedMediaIds.length;
    if (!trimmedPublishedMediaIds.length || !rawStoryMediaComplete || !rawMediaIdsUnique) {
      const error = new Error(readiness.content_type === "story"
        ? "Instagram did not return one unique authoritative published media identifier for every Story frame; the outcome requires reconciliation"
        : "Instagram did not return a published media identifier; the outcome requires reconciliation");
      error.code = "instagram_publish_identifier_missing";
      error.details = {
        instagram_publish_stage: "media_publish",
        instagram_outcome_uncertain: true,
        creation_id: result?.creation_id || publication.creation_id || null,
        child_creation_ids: result?.child_creation_ids || publication.child_creation_ids || [],
        creation_ids: result?.creation_ids || [],
        media_ids: trimmedPublishedMediaIds,
        story_frames: result?.story_frames || [],
      };
      throw error;
    }
    let publishedMediaIds;
    try {
      publishedMediaIds = trimmedPublishedMediaIds.map((mediaId) => (
        normalizeAuthoritativePublicationId(mediaId, {
          ...publication,
          creation_id: result?.creation_id || publication.creation_id,
          child_creation_ids: resultCreationIds,
          provider_checkpoint: {
            ...(publication.provider_checkpoint || {}),
            creation_ids: resultCreationIds,
            child_creation_ids: resultCreationIds,
          },
        })
      ));
    } catch (validationError) {
      const error = new Error("Instagram returned a non-authoritative media identifier; the outcome requires reconciliation");
      error.code = "instagram_publish_identifier_not_authoritative";
      error.details = {
        instagram_publish_stage: "media_publish",
        instagram_outcome_uncertain: true,
        creation_id: result?.creation_id || publication.creation_id || null,
        child_creation_ids: resultCreationIds,
        creation_ids: resultCreationIds,
        media_ids: trimmedPublishedMediaIds,
        story_frames: result?.story_frames || [],
        validation_code: validationError.code || null,
      };
      throw error;
    }
    const publishedMediaId = publishedMediaIds[0] || null;
    const publishedAt = new Date();
    const enrichmentWarning = normalizeMediaEnrichmentWarning(result?.enrichment_warning);
    publication.status = "PUBLISHED";
    publication.external_publication_id = publishedMediaId;
    publication.external_publication_ids = publishedMediaIds;
    publication.external_permalink = result.permalink || null;
    publication.external_permalinks = Array.isArray(result?.permalinks) ? result.permalinks.filter(Boolean) : [];
    publication.provider_response_metadata = {
      content_type: result.content_type,
      resumed: Boolean(result.resumed),
      account_username: result.connection?.instagram_username || null,
      media_enrichment_status: enrichmentWarning ? "WARNING" : "COMPLETE",
      media_enrichment_warning: enrichmentWarning,
      prepublish_asset_integrity: prepublishAssetIntegrity,
      ...(readiness.content_type === "story" ? {
        story_frame_count: publishedMediaIds.length,
        story_frames: result?.story_frames || [],
        external_publication_ids: publishedMediaIds,
      } : {}),
    };
    publication.published_at = publishedAt;
    publication.finished_at = publishedAt;
    publication.next_retry_at = null;
    publication.lease_owner = null;
    publication.lease_expires_at = null;
    publication.heartbeat_at = publishedAt;
    publication.last_error = null;
    await publication.save();

    draft.status = "PUBLISHED";
    draft.published_at = publishedAt;
    draft.failed_at = null;
    draft.last_error = null;
    draft.publication_json = {
      status: "PUBLISHED",
      external_publication_id: publishedMediaId,
      external_publication_ids: publishedMediaIds,
      external_permalink: result.permalink || null,
      external_permalinks: publication.external_permalinks,
      published_at: publishedAt,
      media_enrichment_status: enrichmentWarning ? "WARNING" : "COMPLETE",
      media_enrichment_warning: enrichmentWarning,
    };
    await draft.save();
    await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, {
      status: "PUBLISHED",
      publicationId: publication._id,
      dependencies,
    });
    publication.draft_reconciled_at = publishedAt;
    await publication.save();
    await appendAudit({
      action: "PUBLISHED",
      summary: "The approved social draft was published to Instagram.",
      draft,
      publication,
      actorAdminId,
      metadata: {
        external_publication_id: publishedMediaId,
        external_publication_ids: publishedMediaIds,
        permalink: result.permalink || null,
        media_enrichment_status: enrichmentWarning ? "WARNING" : "COMPLETE",
      },
      models,
    });
    await persistPublishedMediaEnrichmentWarning({
      warning: enrichmentWarning,
      draft,
      publication,
      actorAdminId,
      publishedAt,
      models,
    });
    return publication;
  } catch (error) {
    const failedAt = new Date();
    const uncertain = Boolean(error?.details?.instagram_outcome_uncertain);
    const retriable = isRetriablePublishError(error) && publication.attempt_count < publication.max_attempts;
    publication.status = uncertain ? "UNCERTAIN" : "FAILED";
    publication.retry_count += retriable ? 1 : 0;
    publication.next_retry_at = retriable ? new Date(failedAt.getTime() + retryDelayMs(publication, settings)) : null;
    publication.finished_at = retriable ? null : failedAt;
    publication.lease_owner = null;
    publication.lease_expires_at = null;
    publication.heartbeat_at = failedAt;
    publication.provider_checkpoint = {
      ...(publication.provider_checkpoint || {}),
      ...(error?.details?.creation_id ? { creation_id: error.details.creation_id } : {}),
      ...(error?.details?.creation_ids ? { creation_ids: error.details.creation_ids } : {}),
      ...(error?.details?.child_creation_ids ? { child_creation_ids: error.details.child_creation_ids } : {}),
      ...(error?.details?.media_ids ? { media_ids: error.details.media_ids } : {}),
      ...(error?.details?.story_frames ? { story_frames: error.details.story_frames } : {}),
    };
    if (Array.isArray(error?.details?.media_ids) && error.details.media_ids.length) {
      publication.external_publication_ids = error.details.media_ids.map(trimText).filter(Boolean);
      publication.external_publication_id = publication.external_publication_ids[0] || publication.external_publication_id;
    }
    publication.last_error = {
      code: error.code || "instagram_publish_failed",
      message: trimText(error.message).slice(0, 4000),
      provider_code: error?.response?.data?.error?.code ? String(error.response.data.error.code) : null,
      is_retriable: retriable,
      occurred_at: failedAt,
    };
    await publication.save();
    draft.status = "FAILED";
    draft.failed_at = failedAt;
    draft.last_error = {
      code: publication.last_error.code,
      message: publication.last_error.message,
      stage: uncertain ? "PUBLISH_OUTCOME_UNCERTAIN" : "PUBLISHING",
      is_retriable: retriable,
      occurred_at: failedAt,
    };
    draft.publication_json = {
      status: publication.status,
      retry_scheduled_for: publication.next_retry_at,
      outcome_uncertain: uncertain,
    };
    await draft.save();
    const reconciliationAction = uncertain
      ? await persistPublicationUncertainManualAction({
        draft,
        publication,
        actorAdminId,
        occurredAt: failedAt,
        error,
        models,
      })
      : null;
    await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, {
      status: "FAILED",
      publicationId: publication._id,
      dependencies,
    });
    await appendAudit({
      action: uncertain ? "PUBLISH_OUTCOME_UNCERTAIN" : "PUBLISH_FAILED",
      actionStatus: "FAILED",
      summary: uncertain
        ? "Instagram may have accepted the publication, so automatic retry was stopped for manual reconciliation."
        : "Instagram publication failed and was not recorded as successful.",
      draft,
      publication,
      actorAdminId,
      metadata: {
        retriable,
        next_retry_at: publication.next_retry_at,
        manual_action_id: reconciliationAction?._id || reconciliationAction?.id || null,
      },
      error,
      models,
    });
    error.publication = publication;
    throw error;
  }
}

async function recoverStaleSocialPublications({ now = new Date(), limit = 20, dependencies = {} } = {}) {
  const models = {
    SocialAuditLog: dependencies.SocialAuditLog || SocialAuditLog,
    SocialManualAction: dependencies.SocialManualAction || SocialManualAction,
    SocialPostDraft: dependencies.SocialPostDraft || SocialPostDraft,
    SocialPublication: dependencies.SocialPublication || SocialPublication,
  };
  const staleRows = await models.SocialPublication.find({
    status: { $in: ["VALIDATING", "CONTAINER_CREATED", "PUBLISHING"] },
    lease_expires_at: { $lte: now },
  })
    .sort({ lease_expires_at: 1 })
    .limit(Math.max(Number(limit || 20), 1));
  let requeued = 0;
  let uncertain = 0;
  for (const stale of staleRows) {
    const crossedPublishCheckpoint = stale.status === "PUBLISHING"
      && !storySequenceCheckpointSafelyResumable(stale);
    const nextStatus = crossedPublishCheckpoint ? "UNCERTAIN" : "FAILED";
    const recovered = await models.SocialPublication.findOneAndUpdate(
      { _id: stale._id, status: stale.status, lease_expires_at: { $lte: now } },
      {
        $set: {
          status: nextStatus,
          next_retry_at: crossedPublishCheckpoint ? null : now,
          finished_at: crossedPublishCheckpoint ? now : null,
          lease_owner: null,
          lease_expires_at: null,
          heartbeat_at: now,
          last_error: {
            code: crossedPublishCheckpoint ? "stale_publish_outcome_uncertain" : "stale_publish_attempt_requeued",
            message: crossedPublishCheckpoint
              ? "The worker lease expired after the pre-publish checkpoint; manual Instagram reconciliation is required."
              : "The worker lease expired before the publish checkpoint; the durable attempt was safely queued for resume.",
            is_retriable: !crossedPublishCheckpoint,
            occurred_at: now,
          },
        },
      },
      { new: true },
    );
    if (!recovered) continue;
    const draft = await models.SocialPostDraft.findById(recovered.draft_id);
    const draftWasPublishing = Boolean(draft && draft.status === "PUBLISHING");
    if (draftWasPublishing) {
      draft.status = "FAILED";
      draft.failed_at = now;
      draft.last_error = {
        code: recovered.last_error.code,
        message: recovered.last_error.message,
        stage: crossedPublishCheckpoint ? "PUBLISH_OUTCOME_UNCERTAIN" : "PUBLISHING",
        is_retriable: !crossedPublishCheckpoint,
        occurred_at: now,
      };
      draft.publication_json = {
        status: nextStatus,
        retry_scheduled_for: recovered.next_retry_at,
        outcome_uncertain: crossedPublishCheckpoint,
      };
      await draft.save();
    }
    const reconciliationAction = crossedPublishCheckpoint
      ? await persistPublicationUncertainManualAction({
        draft,
        publication: recovered,
        occurredAt: now,
        models,
      })
      : null;
    if (draftWasPublishing) {
      await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, {
        status: "FAILED",
        publicationId: recovered._id,
        dependencies,
      });
      await appendAudit({
        action: crossedPublishCheckpoint ? "PUBLISH_OUTCOME_UNCERTAIN" : "PUBLISH_REQUEUED_AFTER_STALE_LEASE",
        actionStatus: crossedPublishCheckpoint ? "FAILED" : "SUCCEEDED",
        summary: crossedPublishCheckpoint
          ? "A stale Instagram attempt crossed the publish checkpoint and was quarantined for manual reconciliation."
          : "A stale pre-publish Instagram attempt was safely queued for durable resume.",
        draft,
        publication: recovered,
        metadata: {
          stale_lease_recovered_at: now,
          manual_action_id: reconciliationAction?._id || reconciliationAction?.id || null,
        },
        models,
      });
    }
    if (crossedPublishCheckpoint) uncertain += 1;
    else requeued += 1;
  }
  return { inspected: staleRows.length, requeued, uncertain };
}

async function reconcileCheckpointedSocialPublications({ now = new Date(), limit = 20, dependencies = {} } = {}) {
  const models = {
    SocialAuditLog: dependencies.SocialAuditLog || SocialAuditLog,
    SocialPostDraft: dependencies.SocialPostDraft || SocialPostDraft,
    SocialPublication: dependencies.SocialPublication || SocialPublication,
  };
  const publications = await models.SocialPublication.find({
    status: "PUBLISHED",
    external_publication_id: { $nin: [null, ""] },
    draft_reconciled_at: null,
  })
    .sort({ published_at: -1, updated_at: -1 })
    .limit(Math.max(Number(limit || 20), 1));
  let reconciled = 0;
  for (const publication of publications) {
    const draft = await models.SocialPostDraft.findById(publication.draft_id);
    if (!draft) continue;
    if (draft.status === "PUBLISHED") {
      await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, {
        status: "PUBLISHED",
        publicationId: publication._id,
        dependencies,
      });
      publication.draft_reconciled_at = publication.draft_reconciled_at || now;
      await publication.save();
      continue;
    }
    draft.status = "PUBLISHED";
    draft.published_at = publication.published_at || now;
    draft.failed_at = null;
    draft.last_error = null;
    draft.publication_id = publication._id;
    draft.publication_json = {
      status: "PUBLISHED",
      external_publication_id: publication.external_publication_id,
      external_publication_ids: publication.external_publication_ids || [publication.external_publication_id],
      external_permalink: publication.external_permalink || null,
      external_permalinks: publication.external_permalinks || [],
      published_at: draft.published_at,
      reconciled_from_provider_checkpoint: true,
    };
    await draft.save();
    await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, {
      status: "PUBLISHED",
      publicationId: publication._id,
      dependencies,
    });
    publication.draft_reconciled_at = now;
    await publication.save();
    await appendAudit({
      action: "PUBLISH_RECONCILED_FROM_CHECKPOINT",
      summary: "A real Instagram media ID persisted before a worker interruption; the draft was reconciled to PUBLISHED without another provider call.",
      draft,
      publication,
      metadata: {
        external_publication_id: publication.external_publication_id,
        external_publication_ids: publication.external_publication_ids || [publication.external_publication_id],
      },
      models,
    });
    reconciled += 1;
  }
  return { inspected: publications.length, reconciled };
}

async function processDueSocialPublishes({ now = new Date(), settings, limit = 3, dependencies = {} } = {}) {
  if (!publishingFeatureEnabled(settings)) return { processed: 0, published: 0, failed: 0, skipped: "publishing_disabled" };
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const PublicationModel = dependencies.SocialPublication || SocialPublication;
  await reconcileCheckpointedSocialPublications({ now, dependencies });
  await recoverStaleSocialPublications({ now, dependencies });
  const scheduledDrafts = await DraftModel.find({ status: "SCHEDULED", scheduled_for: { $lte: now } })
    .sort({ scheduled_for: 1 })
    .limit(Math.max(Number(limit || 3), 1))
    .select("_id")
    .lean();
  let remaining = Math.max(Number(limit || 3) - scheduledDrafts.length, 0);
  const queuedPublications = remaining
    ? await PublicationModel.find({
      status: "QUEUED",
      $or: [{ scheduled_for: null }, { scheduled_for: { $lte: now } }],
    })
      .sort({ queued_at: 1, created_at: 1 })
      .limit(remaining)
      .select("draft_id")
      .lean()
    : [];
  remaining = Math.max(remaining - queuedPublications.length, 0);
  const retryPublications = remaining
    ? await PublicationModel.find({ status: "FAILED", next_retry_at: { $lte: now } })
      .sort({ next_retry_at: 1 })
      .limit(remaining)
      .select("draft_id")
      .lean()
    : [];
  const ids = [...new Set([
    ...scheduledDrafts.map((draft) => String(draft._id)),
    ...queuedPublications.map((row) => String(row.draft_id)),
    ...retryPublications.map((row) => String(row.draft_id)),
  ])];
  let published = 0;
  let failed = 0;
  const failures = [];
  for (const draftId of ids) {
    try {
      await publishSocialDraft({ draftId, settings, publishNow: false, now, dependencies });
      published += 1;
    } catch (error) {
      failed += 1;
      failures.push({
        draft_id: draftId,
        code: error.code || "social_publish_failed",
        message: trimText(error.message).slice(0, 1000),
        manual_action_id: error.manual_action_id ? String(error.manual_action_id) : null,
      });
    }
  }
  return { processed: ids.length, published, failed, failures };
}

module.exports = {
  autoPublishEnabled,
  buildInstagramCaption,
  buildReadiness,
  getSocialPublishingReadiness,
  instagramContentType,
  processDueSocialPublishes,
  publishSocialDraft,
  queueSocialPublication,
  reconcileUncertainPublication,
  reconcileCheckpointedSocialPublications,
  recoverStaleSocialPublications,
  publishingFeatureEnabled,
  _private: {
    activeAssets,
    assetReady,
    brandLogoPublicationEvidencePassed,
    brandLogoAssetIntegrityError,
    verifyMandatoryBrandPublicationAssetIntegrity,
    isRetriablePublishError,
    normalizeMediaEnrichmentWarning,
    normalizeAuthoritativePublicationId,
    normalizeInstagramPermalink,
    parseBoolean,
    publicPublicationReconciliation,
    persistPublishedMediaEnrichmentWarning,
    persistPublicationUncertainManualAction,
    publicationModelContentType,
    publicationLeaseActive,
    requiredScopePresent,
    retryDelayMs,
    sha256,
    sha256File,
    storySequenceCheckpointSafelyResumable,
  },
};
