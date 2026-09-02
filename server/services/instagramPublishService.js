const axios = require("axios");
const crypto = require("crypto");
const {
  connectInstagramFromCode,
  getActiveInstagramConnection,
  getGraphVersion,
  getInstagramConnectionSummary,
  markInstagramConnectionError,
  markInstagramPublishSuccess,
} = require("./instagramConnectionService");
const logger = require("../utils/logger");

const INSTAGRAM_GRAPH_BASE = "https://graph.instagram.com";

function describeInstagramApiError(error) {
  if (!error) return "Instagram publishing failed";
  const graphError = error.response?.data?.error;

  if (graphError?.message) {
    const parts = [graphError.message];
    if (graphError.type) parts.push(`type: ${graphError.type}`);
    if (graphError.code != null) parts.push(`code: ${graphError.code}`);
    if (graphError.error_subcode != null) parts.push(`subcode: ${graphError.error_subcode}`);
    return parts.join(" | ");
  }

  if (error.response?.data?.message) return String(error.response.data.message);
  if (error.message) return String(error.message);
  return "Instagram publishing failed";
}

function withInstagramOperationContext(error, code, details = {}) {
  const operationError = error instanceof Error
    ? error
    : new Error(String(error || "Instagram publishing failed"));
  operationError.code = code || operationError.code || "instagram_publish_failed";
  operationError.details = {
    ...(operationError.details && typeof operationError.details === "object" ? operationError.details : {}),
    ...details,
  };
  return operationError;
}

function isPublicMediaUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (!host || ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(host)) return false;
    if (host.endsWith(".localhost") || host.endsWith(".local")) return false;

    const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const parts = ipv4Match.slice(1).map((part) => Number(part));
      if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
      const [first, second] = parts;
      if (first === 0 || first === 10 || first === 127 || (first === 169 && second === 254)) return false;
      if (first === 172 && second >= 16 && second <= 31) return false;
      if (first === 192 && second === 168) return false;
    }

    if (host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
    return true;
  } catch (_error) {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphGet(path, params, accessToken) {
  const response = await axios.get(`${INSTAGRAM_GRAPH_BASE}/${getGraphVersion()}/${path.replace(/^\/+/, "")}`, {
    params: {
      ...params,
      access_token: accessToken,
    },
    timeout: 25000,
  });
  return response.data;
}

async function graphPost(path, params, accessToken) {
  const response = await axios.post(
    `${INSTAGRAM_GRAPH_BASE}/${getGraphVersion()}/${path.replace(/^\/+/, "")}`,
    new URLSearchParams({
      ...Object.fromEntries(Object.entries(params || {}).map(([key, value]) => [key, value == null ? "" : String(value)])),
      access_token: accessToken,
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 30000,
    }
  );
  return response.data;
}

function assertPublishableUrls(assetUrls) {
  if (!Array.isArray(assetUrls) || !assetUrls.length) {
    throw new Error("No Instagram creative assets are available for publishing");
  }

  const invalid = assetUrls.filter((url) => !isPublicMediaUrl(url));
  if (invalid.length) {
    throw new Error("Instagram publishing requires publicly reachable HTTPS media URLs. Check SERVER_URL or PUBLIC_MEDIA_BASE_URL.");
  }
}

async function fetchInstagramAccountInfo() {
  const connection = await getActiveInstagramConnection();
  return connection;
}

async function exchangeAuthCodeForToken({ code, state }) {
  return connectInstagramFromCode({ code, state });
}

async function getContentPublishingLimit(userAccessToken, igUserId) {
  try {
    return await graphGet(`${igUserId}/content_publishing_limit`, {}, userAccessToken);
  } catch (_error) {
    return null;
  }
}

async function getContainerStatus(containerId, userAccessToken) {
  return graphGet(containerId, { fields: "id,status,status_code" }, userAccessToken);
}

async function pollPublishStatus(containerId, userAccessToken, {
  maxAttempts = 10,
  delayMs = 3000,
} = {}) {
  let lastStatus = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let status;
    try {
      status = await getContainerStatus(containerId, userAccessToken);
    } catch (error) {
      throw withInstagramOperationContext(error, "instagram_container_status_unavailable", {
        container_id: containerId,
        container_failure_terminal: false,
      });
    }
    lastStatus = status;
    const code = String(status?.status_code || "").toUpperCase();

    if (code === "FINISHED" || code === "PUBLISHED") return status;
    if (code === "ERROR" || code === "EXPIRED") {
      throw withInstagramOperationContext(
        new Error(status?.status || `Instagram media container ${containerId} failed with ${code}`),
        "instagram_container_failed",
        {
          container_id: containerId,
          container_status: code,
          container_failure_terminal: true,
        }
      );
    }

    if (attempt < maxAttempts - 1) await sleep(delayMs);
  }

  throw withInstagramOperationContext(
    new Error(`Instagram media container ${containerId} did not finish processing in time`),
    "instagram_container_pending",
    {
      container_id: containerId,
      container_status: lastStatus?.status_code || null,
      container_failure_terminal: false,
    }
  );
}

async function createImageContainer(igUserId, userAccessToken, { imageUrl, caption, isCarouselItem = false, mediaType = null }) {
  const payload = {
    image_url: imageUrl,
    ...(caption ? { caption } : {}),
    ...(isCarouselItem ? { is_carousel_item: "true" } : {}),
    ...(mediaType ? { media_type: String(mediaType).toUpperCase() } : {}),
  };

  return graphPost(`${igUserId}/media`, payload, userAccessToken);
}

async function createVideoContainer(igUserId, userAccessToken, {
  videoUrl,
  caption,
  mediaType = "REELS",
  shareToFeed = null,
  coverUrl = null,
  thumbOffset = null,
}) {
  const normalizedType = String(mediaType || "REELS").toUpperCase();
  if (!["REELS", "STORIES"].includes(normalizedType)) {
    throw new Error(`Unsupported Instagram video container type ${mediaType}`);
  }
  return graphPost(`${igUserId}/media`, {
    media_type: normalizedType,
    video_url: videoUrl,
    ...(caption && normalizedType !== "STORIES" ? { caption } : {}),
    ...(shareToFeed != null && normalizedType === "REELS" ? { share_to_feed: shareToFeed ? "true" : "false" } : {}),
    ...(coverUrl && normalizedType === "REELS" ? { cover_url: coverUrl } : {}),
    ...(thumbOffset != null && normalizedType === "REELS" ? { thumb_offset: String(thumbOffset) } : {}),
  }, userAccessToken);
}

async function createCarouselContainer(igUserId, userAccessToken, { children, caption }) {
  return graphPost(`${igUserId}/media`, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption,
  }, userAccessToken);
}

async function publishContainer(igUserId, userAccessToken, creationId) {
  return graphPost(`${igUserId}/media_publish`, {
    creation_id: creationId,
  }, userAccessToken);
}

function assertPublishedMediaIdentifier(published, details = {}) {
  const mediaId = String(published?.id || "").trim();
  if (!mediaId) {
    throw withInstagramOperationContext(
      new Error("Meta did not return a published media identifier"),
      "instagram_publish_identifier_missing",
      {
        instagram_publish_stage: "media_publish",
        instagram_outcome_uncertain: true,
        ...details,
      },
    );
  }
  const containerIds = [
    details.creation_id,
    ...(Array.isArray(details.creation_ids) ? details.creation_ids : []),
    ...(Array.isArray(details.child_creation_ids) ? details.child_creation_ids : []),
    ...(Array.isArray(details.container_ids) ? details.container_ids : []),
  ].map((value) => String(value || "").trim()).filter(Boolean);
  if (containerIds.includes(mediaId)) {
    throw withInstagramOperationContext(
      new Error("Meta returned a creation/container identifier instead of an authoritative published media identifier"),
      "instagram_publish_identifier_not_authoritative",
      {
        instagram_publish_stage: "media_publish",
        instagram_outcome_uncertain: true,
        ...details,
      },
    );
  }
  return mediaId;
}

async function getMediaInfo(mediaId, userAccessToken) {
  return graphGet(mediaId, {
    fields: "id,permalink,media_type,media_product_type,caption,timestamp",
  }, userAccessToken);
}

function mediaEnrichmentWarning(error) {
  const providerStatus = Number(error?.response?.status || error?.status || error?.statusCode || 0) || null;
  const rawProviderCode = error?.response?.data?.error?.code ?? error?.code ?? null;
  const normalizedProviderCode = rawProviderCode == null
    ? null
    : String(rawProviderCode).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
  const providerCode = normalizedProviderCode
    && !/(?:access|refresh)[_-]?token|secret|password|authorization|api[_-]?key/i.test(normalizedProviderCode)
    ? normalizedProviderCode
    : null;
  return {
    code: "instagram_media_enrichment_failed",
    message: "Instagram published the media, but the follow-up media/permalink lookup failed. Do not republish; retry enrichment for the stored Meta media ID.",
    provider_status: providerStatus,
    provider_code: providerCode,
    is_retriable: !providerStatus || [408, 409, 425, 429, 500, 502, 503, 504].includes(providerStatus),
  };
}

async function enrichPublishedMediaInfo(mediaId, userAccessToken) {
  try {
    return { mediaInfo: await getMediaInfo(mediaId, userAccessToken), warning: null };
  } catch (error) {
    return { mediaInfo: { id: mediaId }, warning: mediaEnrichmentWarning(error) };
  }
}

async function publishSingleImage({ connection, assetUrls, caption, contentType = "single_image", resumeState = {}, onProgress = null }) {
  const imageUrl = assetUrls[0];
  const isStory = String(contentType).toLowerCase() === "story";
  if (isStory && String(connection.account_type || "").toUpperCase() !== "BUSINESS") {
    const error = new Error("Instagram Story publishing through the API requires a Business account");
    error.code = "instagram_story_business_account_required";
    throw error;
  }
  const creation = resumeState.creation_id
    ? { id: resumeState.creation_id }
    : await createImageContainer(connection.instagram_user_id, connection.user_access_token, {
      imageUrl,
      caption: isStory ? null : caption,
      mediaType: isStory ? "STORIES" : null,
    });

  if (!resumeState.creation_id && onProgress) {
    await onProgress({ status: "container_created", creation_id: creation.id, child_creation_ids: [] });
  }

  try {
    await pollPublishStatus(creation.id, connection.user_access_token);
  } catch (error) {
    throw withInstagramOperationContext(error, error.code || "instagram_container_failed", {
      instagram_publish_stage: "single_container",
      creation_id: creation.id,
    });
  }
  if (resumeState.media_id) {
    const enrichment = await enrichPublishedMediaInfo(resumeState.media_id, connection.user_access_token);
    const mediaInfo = enrichment.mediaInfo;
    return {
      content_type: isStory ? "story" : "single_image",
      creation_id: creation.id,
      media_id: resumeState.media_id,
      permalink: resumeState.permalink || mediaInfo?.permalink || null,
      media_info: mediaInfo,
      enrichment_warning: enrichment.warning,
      resumed: true,
    };
  }
  if (onProgress) {
    try {
      await onProgress({ status: "publishing", creation_id: creation.id, child_creation_ids: [] });
    } catch (error) {
      throw withInstagramOperationContext(error, "instagram_publish_checkpoint_failed", {
        instagram_publish_stage: "pre_media_publish",
        instagram_outcome_uncertain: false,
        creation_id: creation.id,
        child_creation_ids: [],
      });
    }
  }
  let published;
  try {
    published = await publishContainer(connection.instagram_user_id, connection.user_access_token, creation.id);
  } catch (error) {
    throw withInstagramOperationContext(error, "instagram_publish_outcome_uncertain", {
      instagram_publish_stage: "media_publish",
      instagram_outcome_uncertain: true,
      creation_id: creation.id,
      child_creation_ids: [],
    });
  }
  const mediaId = assertPublishedMediaIdentifier(published, {
    creation_id: creation.id,
    child_creation_ids: [],
  });
  const enrichment = await enrichPublishedMediaInfo(mediaId, connection.user_access_token);
  const mediaInfo = enrichment.mediaInfo;
  if (onProgress) {
    await onProgress({
      status: "published",
      creation_id: creation.id,
      child_creation_ids: [],
      media_id: mediaId,
      permalink: mediaInfo?.permalink || null,
      enrichment_warning: enrichment.warning,
    }).catch((error) => {
      logger.error({ err: error, instagramMediaId: mediaId }, "Instagram media published but final progress persistence failed");
    });
  }

  return {
    content_type: isStory ? "story" : "single_image",
    creation_id: creation.id,
    media_id: mediaId,
    permalink: mediaInfo?.permalink || null,
    media_info: mediaInfo,
    enrichment_warning: enrichment.warning,
  };
}

async function publishCarousel({ connection, assetUrls, caption, resumeState = {}, onProgress = null }) {
  const childIds = Array.isArray(resumeState.child_creation_ids) ? [...resumeState.child_creation_ids] : [];

  if (childIds.length > assetUrls.length) {
    throw withInstagramOperationContext(
      new Error("Stored Instagram carousel children do not match the current slide count"),
      "instagram_carousel_checkpoint_invalid",
      { instagram_publish_stage: "child_container", child_creation_ids: childIds }
    );
  }

  for (let index = 0; index < childIds.length; index += 1) {
    try {
      await pollPublishStatus(childIds[index], connection.user_access_token, { maxAttempts: 6, delayMs: 2500 });
    } catch (error) {
      throw withInstagramOperationContext(error, error.code || "instagram_child_container_failed", {
        instagram_publish_stage: "child_container",
        failed_child_index: index,
        creation_id: resumeState.creation_id || null,
        child_creation_ids: childIds,
      });
    }
  }

  for (let index = childIds.length; index < Math.min(assetUrls.length, 10); index += 1) {
    try {
      const child = await createImageContainer(connection.instagram_user_id, connection.user_access_token, {
        imageUrl: assetUrls[index],
        isCarouselItem: true,
      });
      childIds.push(child.id);
      if (onProgress) await onProgress({ status: "container_created", creation_id: resumeState.creation_id || null, child_creation_ids: childIds });
      await pollPublishStatus(child.id, connection.user_access_token, { maxAttempts: 6, delayMs: 2500 });
    } catch (error) {
      throw withInstagramOperationContext(error, error.code || "instagram_child_container_failed", {
        instagram_publish_stage: "child_container",
        failed_child_index: index,
        creation_id: resumeState.creation_id || null,
        child_creation_ids: childIds,
      });
    }
  }

  let parent;
  try {
    parent = resumeState.creation_id
      ? { id: resumeState.creation_id }
      : await createCarouselContainer(connection.instagram_user_id, connection.user_access_token, { children: childIds, caption });
  } catch (error) {
    throw withInstagramOperationContext(error, error.code || "instagram_parent_container_failed", {
      instagram_publish_stage: "parent_container",
      creation_id: null,
      child_creation_ids: childIds,
    });
  }

  if (!resumeState.creation_id && onProgress) {
    await onProgress({ status: "container_created", creation_id: parent.id, child_creation_ids: childIds });
  }

  try {
    await pollPublishStatus(parent.id, connection.user_access_token, { maxAttempts: 8, delayMs: 3000 });
  } catch (error) {
    throw withInstagramOperationContext(error, error.code || "instagram_parent_container_failed", {
      instagram_publish_stage: "parent_container",
      creation_id: parent.id,
      child_creation_ids: childIds,
    });
  }
  if (resumeState.media_id) {
    const enrichment = await enrichPublishedMediaInfo(resumeState.media_id, connection.user_access_token);
    const mediaInfo = enrichment.mediaInfo;
    return {
      content_type: "carousel",
      creation_id: parent.id,
      child_creation_ids: childIds,
      media_id: resumeState.media_id,
      permalink: resumeState.permalink || mediaInfo?.permalink || null,
      media_info: mediaInfo,
      enrichment_warning: enrichment.warning,
      resumed: true,
    };
  }
  if (onProgress) {
    try {
      await onProgress({ status: "publishing", creation_id: parent.id, child_creation_ids: childIds });
    } catch (error) {
      throw withInstagramOperationContext(error, "instagram_publish_checkpoint_failed", {
        instagram_publish_stage: "pre_media_publish",
        instagram_outcome_uncertain: false,
        creation_id: parent.id,
        child_creation_ids: childIds,
      });
    }
  }
  let published;
  try {
    published = await publishContainer(connection.instagram_user_id, connection.user_access_token, parent.id);
  } catch (error) {
    throw withInstagramOperationContext(error, "instagram_publish_outcome_uncertain", {
      instagram_publish_stage: "media_publish",
      instagram_outcome_uncertain: true,
      creation_id: parent.id,
      child_creation_ids: childIds,
    });
  }
  const mediaId = assertPublishedMediaIdentifier(published, {
    creation_id: parent.id,
    child_creation_ids: childIds,
  });
  const enrichment = await enrichPublishedMediaInfo(mediaId, connection.user_access_token);
  const mediaInfo = enrichment.mediaInfo;
  if (onProgress) {
    await onProgress({
      status: "published",
      creation_id: parent.id,
      child_creation_ids: childIds,
      media_id: mediaId,
      permalink: mediaInfo?.permalink || null,
      enrichment_warning: enrichment.warning,
    }).catch((error) => {
      logger.error({ err: error, instagramMediaId: mediaId }, "Instagram carousel published but final progress persistence failed");
    });
  }

  return {
    content_type: "carousel",
    creation_id: parent.id,
    child_creation_ids: childIds,
    media_id: mediaId,
    permalink: mediaInfo?.permalink || null,
    media_info: mediaInfo,
    enrichment_warning: enrichment.warning,
  };
}

async function publishVideo({ connection, assetUrls, caption, contentType = "reel", resumeState = {}, onProgress = null }) {
  const normalizedType = String(contentType || "reel").toLowerCase();
  const isStory = normalizedType === "story";
  if (isStory && String(connection.account_type || "").toUpperCase() !== "BUSINESS") {
    const error = new Error("Instagram Story publishing through the API requires a Business account");
    error.code = "instagram_story_business_account_required";
    throw error;
  }
  const creation = resumeState.creation_id
    ? { id: resumeState.creation_id }
    : await createVideoContainer(connection.instagram_user_id, connection.user_access_token, {
      videoUrl: assetUrls[0],
      caption,
      mediaType: isStory ? "STORIES" : "REELS",
      shareToFeed: !isStory,
      coverUrl: resumeState.cover_url || null,
      thumbOffset: resumeState.thumb_offset ?? null,
    });
  if (!resumeState.creation_id && onProgress) {
    await onProgress({ status: "container_created", creation_id: creation.id, child_creation_ids: [] });
  }
  try {
    await pollPublishStatus(creation.id, connection.user_access_token, {
      maxAttempts: Math.max(Number(process.env.INSTAGRAM_VIDEO_STATUS_MAX_ATTEMPTS || 20), 1),
      delayMs: Math.max(Number(process.env.INSTAGRAM_VIDEO_STATUS_DELAY_MS || 15000), 1000),
    });
  } catch (error) {
    throw withInstagramOperationContext(error, error.code || "instagram_video_container_failed", {
      instagram_publish_stage: "video_container",
      creation_id: creation.id,
      content_type: normalizedType,
    });
  }
  if (resumeState.media_id) {
    const enrichment = await enrichPublishedMediaInfo(resumeState.media_id, connection.user_access_token);
    const mediaInfo = enrichment.mediaInfo;
    return {
      content_type: normalizedType,
      creation_id: creation.id,
      media_id: resumeState.media_id,
      permalink: resumeState.permalink || mediaInfo?.permalink || null,
      media_info: mediaInfo,
      enrichment_warning: enrichment.warning,
      resumed: true,
    };
  }
  if (onProgress) {
    try {
      await onProgress({ status: "publishing", creation_id: creation.id, child_creation_ids: [] });
    } catch (error) {
      throw withInstagramOperationContext(error, "instagram_publish_checkpoint_failed", {
        instagram_publish_stage: "pre_media_publish",
        instagram_outcome_uncertain: false,
        creation_id: creation.id,
      });
    }
  }
  let published;
  try {
    published = await publishContainer(connection.instagram_user_id, connection.user_access_token, creation.id);
  } catch (error) {
    throw withInstagramOperationContext(error, "instagram_publish_outcome_uncertain", {
      instagram_publish_stage: "media_publish",
      instagram_outcome_uncertain: true,
      creation_id: creation.id,
      content_type: normalizedType,
    });
  }
  const mediaId = assertPublishedMediaIdentifier(published, {
    creation_id: creation.id,
    content_type: normalizedType,
  });
  const enrichment = await enrichPublishedMediaInfo(mediaId, connection.user_access_token);
  const mediaInfo = enrichment.mediaInfo;
  if (onProgress) {
    await onProgress({
      status: "published",
      creation_id: creation.id,
      child_creation_ids: [],
      media_id: mediaId,
      permalink: mediaInfo?.permalink || null,
      enrichment_warning: enrichment.warning,
    }).catch((error) => logger.error({ err: error, instagramMediaId: mediaId }, "Instagram video published but final progress persistence failed"));
  }
  return {
    content_type: normalizedType,
    creation_id: creation.id,
    media_id: mediaId,
    permalink: mediaInfo?.permalink || null,
    media_info: mediaInfo,
    enrichment_warning: enrichment.warning,
  };
}

function storyAssetFingerprint(url) {
  return crypto.createHash("sha256").update(String(url || "")).digest("hex");
}

function storyCheckpointError(message, code = "instagram_story_checkpoint_invalid", details = {}) {
  return withInstagramOperationContext(new Error(message), code, {
    instagram_publish_stage: "story_sequence",
    instagram_outcome_uncertain: false,
    ...details,
  });
}

function normalizeStorySequenceState(assetUrls, assetMimeTypes, resumeState = {}) {
  if (!Array.isArray(assetUrls) || assetUrls.length < 1 || assetUrls.length > 10) {
    throw storyCheckpointError(
      "An Instagram Story sequence requires between one and ten ordered media assets",
      "instagram_story_asset_count_invalid",
    );
  }
  if (assetMimeTypes.length && assetMimeTypes.length !== assetUrls.length) {
    throw storyCheckpointError(
      "The Story MIME-type sequence does not match the ordered asset sequence",
      "instagram_story_asset_sequence_invalid",
    );
  }

  const storedFrames = Array.isArray(resumeState.story_frames) ? resumeState.story_frames : [];
  if (storedFrames.length > assetUrls.length) {
    throw storyCheckpointError(
      "The stored Story checkpoint has more frames than the approved Story",
      "instagram_story_checkpoint_invalid",
    );
  }
  const storedCreationIds = Array.isArray(resumeState.creation_ids)
    ? resumeState.creation_ids
    : Array.isArray(resumeState.child_creation_ids) ? resumeState.child_creation_ids : [];
  const storedMediaIds = Array.isArray(resumeState.media_ids) ? resumeState.media_ids : [];

  const frames = assetUrls.map((assetUrl, index) => {
    const stored = storedFrames[index] && typeof storedFrames[index] === "object"
      ? storedFrames[index]
      : {};
    const mimeType = String(assetMimeTypes[index] || stored.mime_type || "image/jpeg").toLowerCase();
    if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/")) {
      throw storyCheckpointError(
        `Story frame ${index + 1} is not an image or video`,
        "instagram_story_media_type_invalid",
        { failed_frame_index: index },
      );
    }
    const assetUrlSha256 = storyAssetFingerprint(assetUrl);
    if (stored.asset_url_sha256 && stored.asset_url_sha256 !== assetUrlSha256) {
      throw storyCheckpointError(
        `Stored Story frame ${index + 1} does not match the approved asset sequence`,
        "instagram_story_checkpoint_invalid",
        { failed_frame_index: index },
      );
    }
    const creationId = String(
      stored.creation_id
      || storedCreationIds[index]
      || (index === 0 ? resumeState.creation_id : "")
      || "",
    ).trim() || null;
    const mediaId = String(
      stored.media_id
      || storedMediaIds[index]
      || (assetUrls.length === 1 && index === 0 ? resumeState.media_id : "")
      || "",
    ).trim() || null;
    return {
      sequence: index + 1,
      asset_url_sha256: assetUrlSha256,
      mime_type: mimeType,
      creation_id: creationId,
      media_id: mediaId,
      permalink: stored.permalink || null,
      enrichment_warning: stored.enrichment_warning || null,
      status: mediaId ? "published" : creationId ? String(stored.status || "container_created") : "pending",
    };
  });

  const creationIds = frames.map((frame) => frame.creation_id).filter(Boolean);
  const mediaIds = frames.map((frame) => frame.media_id).filter(Boolean);
  if (new Set(creationIds).size !== creationIds.length || new Set(mediaIds).size !== mediaIds.length) {
    throw storyCheckpointError(
      "The stored Story checkpoint contains duplicate provider identifiers",
      "instagram_story_checkpoint_invalid",
    );
  }
  let unpublishedSeen = false;
  frames.forEach((frame, index) => {
    if (!frame.media_id) unpublishedSeen = true;
    else if (unpublishedSeen) {
      throw storyCheckpointError(
        "Published Story frame checkpoints must form an ordered prefix",
        "instagram_story_checkpoint_invalid",
        { failed_frame_index: index },
      );
    }
    if (!frame.media_id && frame.status === "publishing") {
      throw storyCheckpointError(
        `Story frame ${index + 1} crossed the publish checkpoint without a confirmed media identifier`,
        "instagram_story_publish_outcome_uncertain",
        {
          instagram_outcome_uncertain: true,
          failed_frame_index: index,
          story_frames: frames,
          creation_ids: creationIds,
          child_creation_ids: creationIds,
          media_ids: mediaIds,
        },
      );
    }
  });
  return frames;
}

function buildStorySequenceCheckpoint(frames, {
  status,
  currentFrameIndex,
  includePrimaryMediaId = false,
} = {}) {
  const creationIds = frames.map((frame) => frame.creation_id).filter(Boolean);
  const mediaIds = frames.map((frame) => frame.media_id).filter(Boolean);
  const permalinks = frames.map((frame) => frame.permalink || null);
  return {
    status,
    content_type: "story",
    current_frame_index: currentFrameIndex,
    creation_id: creationIds[0] || null,
    creation_ids: creationIds,
    child_creation_ids: creationIds,
    media_ids: mediaIds,
    permalinks,
    story_frames: frames.map((frame) => ({ ...frame })),
    ...(includePrimaryMediaId && mediaIds.length === frames.length
      ? { media_id: mediaIds[0], permalink: permalinks[0] || null }
      : {}),
  };
}

async function persistStorySequenceProgress(onProgress, frames, options) {
  if (!onProgress) return;
  const checkpoint = buildStorySequenceCheckpoint(frames, options);
  try {
    await onProgress(checkpoint);
  } catch (error) {
    const publishedMediaIds = frames.map((frame) => frame.media_id).filter(Boolean);
    const currentFramePublishWasConfirmed = ["story_frame_published", "published"].includes(options.status);
    throw withInstagramOperationContext(error, "instagram_publish_checkpoint_failed", {
      instagram_publish_stage: currentFramePublishWasConfirmed ? "post_story_frame_publish" : "pre_media_publish",
      instagram_outcome_uncertain: currentFramePublishWasConfirmed,
      failed_frame_index: options.currentFrameIndex,
      creation_id: checkpoint.creation_id,
      creation_ids: checkpoint.creation_ids,
      child_creation_ids: checkpoint.child_creation_ids,
      media_ids: checkpoint.media_ids,
      story_frames: checkpoint.story_frames,
    });
  }
}

async function publishStorySequence({
  connection,
  assetUrls,
  assetMimeTypes = [],
  resumeState = {},
  onProgress = null,
  dependencies = {},
}) {
  if (String(connection.account_type || "").toUpperCase() !== "BUSINESS") {
    const error = new Error("Instagram Story publishing through the API requires a Business account");
    error.code = "instagram_story_business_account_required";
    throw error;
  }
  const frames = normalizeStorySequenceState(assetUrls, assetMimeTypes, resumeState);
  const createImage = dependencies.createImageContainer || createImageContainer;
  const createVideo = dependencies.createVideoContainer || createVideoContainer;
  const pollStatus = dependencies.pollPublishStatus || pollPublishStatus;
  const publishMedia = dependencies.publishContainer || publishContainer;
  const enrichMedia = dependencies.enrichPublishedMediaInfo || enrichPublishedMediaInfo;

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame.media_id) continue;

    if (!frame.creation_id) {
      let creation;
      try {
        creation = frame.mime_type.startsWith("video/")
          ? await createVideo(connection.instagram_user_id, connection.user_access_token, {
            videoUrl: assetUrls[index],
            caption: null,
            mediaType: "STORIES",
            shareToFeed: null,
          })
          : await createImage(connection.instagram_user_id, connection.user_access_token, {
            imageUrl: assetUrls[index],
            caption: null,
            mediaType: "STORIES",
          });
      } catch (error) {
        throw withInstagramOperationContext(error, error.code || "instagram_story_container_failed", {
          instagram_publish_stage: "story_container",
          instagram_outcome_uncertain: false,
          failed_frame_index: index,
          story_frames: frames,
        });
      }
      frame.creation_id = String(creation?.id || "").trim() || null;
      if (!frame.creation_id) {
        throw storyCheckpointError(
          `Meta did not return a creation identifier for Story frame ${index + 1}`,
          "instagram_story_container_identifier_missing",
          { failed_frame_index: index, story_frames: frames },
        );
      }
      frame.status = "container_created";
      await persistStorySequenceProgress(onProgress, frames, {
        status: "container_created",
        currentFrameIndex: index,
      });
    }

    try {
      await pollStatus(frame.creation_id, connection.user_access_token, frame.mime_type.startsWith("video/")
        ? {
          maxAttempts: Math.max(Number(process.env.INSTAGRAM_VIDEO_STATUS_MAX_ATTEMPTS || 20), 1),
          delayMs: Math.max(Number(process.env.INSTAGRAM_VIDEO_STATUS_DELAY_MS || 15000), 1000),
        }
        : { maxAttempts: 10, delayMs: 3000 });
    } catch (error) {
      throw withInstagramOperationContext(error, error.code || "instagram_story_container_failed", {
        instagram_publish_stage: "story_container",
        failed_frame_index: index,
        creation_id: frame.creation_id,
        creation_ids: frames.map((entry) => entry.creation_id).filter(Boolean),
        child_creation_ids: frames.map((entry) => entry.creation_id).filter(Boolean),
        media_ids: frames.map((entry) => entry.media_id).filter(Boolean),
        story_frames: frames,
      });
    }

    frame.status = "publishing";
    await persistStorySequenceProgress(onProgress, frames, {
      status: "publishing",
      currentFrameIndex: index,
    });

    let published;
    try {
      published = await publishMedia(connection.instagram_user_id, connection.user_access_token, frame.creation_id);
    } catch (error) {
      throw withInstagramOperationContext(error, "instagram_publish_outcome_uncertain", {
        instagram_publish_stage: "media_publish",
        instagram_outcome_uncertain: true,
        failed_frame_index: index,
        creation_id: frame.creation_id,
        creation_ids: frames.map((entry) => entry.creation_id).filter(Boolean),
        child_creation_ids: frames.map((entry) => entry.creation_id).filter(Boolean),
        media_ids: frames.map((entry) => entry.media_id).filter(Boolean),
        story_frames: frames,
      });
    }
    frame.media_id = assertPublishedMediaIdentifier(published, {
      creation_id: frame.creation_id,
      creation_ids: frames.map((entry) => entry.creation_id).filter(Boolean),
      child_creation_ids: frames.map((entry) => entry.creation_id).filter(Boolean),
      failed_frame_index: index,
    });
    const enrichment = await enrichMedia(frame.media_id, connection.user_access_token);
    frame.permalink = enrichment.mediaInfo?.permalink || null;
    frame.enrichment_warning = enrichment.warning || null;
    frame.status = "published";
    const finalFrame = index === frames.length - 1;
    await persistStorySequenceProgress(onProgress, frames, {
      status: finalFrame ? "published" : "story_frame_published",
      currentFrameIndex: index,
      includePrimaryMediaId: finalFrame,
    });
  }

  const finalCheckpoint = buildStorySequenceCheckpoint(frames, {
    status: "published",
    currentFrameIndex: frames.length - 1,
    includePrimaryMediaId: true,
  });
  if (finalCheckpoint.media_ids.length !== frames.length) {
    throw storyCheckpointError(
      "Meta did not return an authoritative media identifier for every Story frame",
      "instagram_story_publish_incomplete",
      {
        instagram_outcome_uncertain: finalCheckpoint.media_ids.length > 0,
        ...finalCheckpoint,
      },
    );
  }
  finalCheckpoint.media_ids.forEach((mediaId) => assertPublishedMediaIdentifier({ id: mediaId }, {
    creation_id: finalCheckpoint.creation_id,
    creation_ids: finalCheckpoint.creation_ids,
    child_creation_ids: finalCheckpoint.child_creation_ids,
    defensive_result_validation: true,
  }));
  return {
    content_type: "story",
    creation_id: finalCheckpoint.creation_id,
    creation_ids: finalCheckpoint.creation_ids,
    child_creation_ids: finalCheckpoint.child_creation_ids,
    media_id: finalCheckpoint.media_id,
    media_ids: finalCheckpoint.media_ids,
    permalink: finalCheckpoint.permalink,
    permalinks: finalCheckpoint.permalinks,
    story_frames: finalCheckpoint.story_frames,
    enrichment_warning: frames.find((frame) => frame.enrichment_warning)?.enrichment_warning || null,
    enrichment_warnings: frames
      .map((frame, index) => frame.enrichment_warning ? { frame_index: index, ...frame.enrichment_warning } : null)
      .filter(Boolean),
    resumed: frames.some((frame) => frame.media_id && resumeState?.story_frames?.length),
  };
}

async function publishInstagramDraft({ contentType, assetUrls, assetMimeTypes = [], caption, resumeState = {}, onProgress = null, dependencies = {} }) {
  const connection = await (dependencies.getActiveInstagramConnection || getActiveInstagramConnection)({ withTokens: true, refreshIfNeeded: true });
  assertPublishableUrls(assetUrls);

  const publishingLimit = await (dependencies.getContentPublishingLimit || getContentPublishingLimit)(connection.user_access_token, connection.instagram_user_id);
  const quotaUsage = Number(
    publishingLimit?.data?.[0]?.quota_usage
    || publishingLimit?.quota_usage
    || 0
  );
  const quotaTotal = Number(
    publishingLimit?.data?.[0]?.quota_total
    || publishingLimit?.data?.[0]?.config?.quota_total
    || publishingLimit?.quota_total
    || 0
  );

  const requestedPublicationCount = contentType === "story" ? assetUrls.length : 1;
  if (quotaTotal > 0 && quotaUsage + requestedPublicationCount > quotaTotal) {
    const error = new Error("Instagram API publishing limit reached for the last 24 hours");
    error.code = "instagram_publishing_quota_reached";
    error.details = {
      provider: "META",
      quota_usage: quotaUsage,
      quota_total: quotaTotal,
      requested_publication_count: requestedPublicationCount,
    };
    throw error;
  }

  let result;
  try {
    if (contentType === "story") {
      result = await (dependencies.publishStorySequence || publishStorySequence)({
        connection,
        assetUrls,
        assetMimeTypes,
        resumeState,
        onProgress,
        dependencies,
      });
    } else if (contentType === "carousel") {
      result = await (dependencies.publishCarousel || publishCarousel)({ connection, assetUrls, caption, resumeState, onProgress });
    } else if (["reel", "video_feed"].includes(contentType)) {
      result = await (dependencies.publishVideo || publishVideo)({ connection, assetUrls, caption, contentType, resumeState, onProgress });
    } else {
      result = await (dependencies.publishSingleImage || publishSingleImage)({ connection, assetUrls, caption, contentType, resumeState, onProgress });
    }
    const resultMediaIds = contentType === "story"
      ? (Array.isArray(result?.media_ids) ? result.media_ids : [])
      : [result?.media_id];
    if (contentType === "story" && resultMediaIds.length !== assetUrls.length) {
      throw withInstagramOperationContext(
        new Error("Meta did not confirm an authoritative published media identifier for every Story frame"),
        "instagram_story_publish_incomplete",
        {
          instagram_publish_stage: "media_publish",
          instagram_outcome_uncertain: resultMediaIds.length > 0,
          creation_id: result?.creation_id || null,
          creation_ids: result?.creation_ids || [],
          child_creation_ids: result?.child_creation_ids || [],
          media_ids: resultMediaIds,
          story_frames: result?.story_frames || [],
          defensive_result_validation: true,
        },
      );
    }
    resultMediaIds.forEach((mediaId) => assertPublishedMediaIdentifier({ id: mediaId }, {
      creation_id: result?.creation_id || null,
      creation_ids: result?.creation_ids || [],
      child_creation_ids: result?.child_creation_ids || [],
      defensive_result_validation: true,
    }));
    if (new Set(resultMediaIds.map(String)).size !== resultMediaIds.length) {
      throw withInstagramOperationContext(
        new Error("Meta returned duplicate media identifiers for the Story sequence"),
        "instagram_story_publish_identifier_duplicate",
        {
          instagram_publish_stage: "media_publish",
          instagram_outcome_uncertain: true,
          media_ids: resultMediaIds,
        },
      );
    }
  } catch (error) {
    await (dependencies.markInstagramConnectionError || markInstagramConnectionError)(describeInstagramApiError(error));
    throw error;
  }

  await (dependencies.markInstagramPublishSuccess || markInstagramPublishSuccess)().catch((error) => {
    logger.error({ err: error, instagramMediaId: result?.media_id || null }, "Instagram publish succeeded but connection bookkeeping failed");
  });

  return {
    ...result,
    publishing_limit: publishingLimit || null,
    connection: {
      instagram_user_id: connection.instagram_user_id,
      instagram_username: connection.instagram_username,
      account_type: connection.account_type || null,
      login_type: connection.login_type || "instagram_business_login",
    },
  };
}

module.exports = {
  assertPublishedMediaIdentifier,
  createVideoContainer,
  exchangeAuthCodeForToken,
  fetchInstagramAccountInfo,
  getContentPublishingLimit,
  getContainerStatus,
  enrichPublishedMediaInfo,
  getMediaInfo,
  getInstagramConnectionSummary,
  isPublicMediaUrl,
  pollPublishStatus,
  publishCarousel,
  publishContainer,
  publishInstagramDraft,
  publishSingleImage,
  publishStorySequence,
  publishVideo,
};
